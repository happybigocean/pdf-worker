import { PDFDocument, degrees } from 'pdf-lib';

/**
 * POST /rotate  – reads raw/transcript.pdf from R2,
 *                calls Document AI,
 *                rotates original PDF (layer-safe),
 *                writes fixed/corrected_transcript.pdf back to R2
 * GET  /download – streams the corrected PDF
 */
export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    /* ---------- Download ---------- */
    if (pathname === '/download') {
      try {
        const pdfObj = await env.SRC.get('fixed/corrected_transcript.pdf');
        if (!pdfObj) return new Response('Fixed PDF not found in R2', { status: 404 });

        const pdfBytes = await pdfObj.arrayBuffer();
        return new Response(pdfBytes, {
          headers: {
            'Content-Type': 'application/pdf',
          },
        });
      } catch (err) {
        console.error('PDF download failed:', err);
        return new Response('Internal Server Error', { status: 500 });
      }
    }

    // Rotate and correct PDF using Google Document AI
    if (pathname === '/rotate' /*&& request.method === 'POST'*/) {
      
        console.log('Starting PDF rotation task');

        const pdfObj = await env.SRC.get('raw/transcript.pdf');
        if (!pdfObj) return new Response('PDF not found', { status: 404 });

        const rawPdfBytes = await pdfObj.arrayBuffer();
        const pdfBytes = await normalizeRotation(rawPdfBytes); 

        // 2. OAuth 2 service-account flow (use a Worker secret, not R2!)
        const jwt = await buildJWT(env.GCP_SA_EMAIL, env.GCP_SA_KEY);
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: jwt,
          }),
        });
        const { access_token } = await tokenRes.json();

        const docAIRes = await fetch(
          `https://us-documentai.googleapis.com/v1/projects/${env.GCP_PROJECT_ID}/locations/${env.GCP_LOCATION}/processors/${env.GCP_PROCESSOR_ID}:process`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              rawDocument: {
                content: arrayBufferToBase64(pdfBytes),
                mimeType: 'application/pdf',
              },
            }),
          }
        );
      const doc = await docAIRes.json();
      // 4. Extract rotation per page
      const angles = (doc.document?.pages || []).map(extractAngle);

      // 5. Apply rotation loss-lessly
      const fixedBytes = await rotatePdf(pdfBytes, angles);

      await env.SRC.put(
        'fixed/corrected_transcript.pdf',
        fixedBytes,
        { httpMetadata: { contentType: 'application/pdf' } },
      );
      // copy JSON for downstream search if you like
      await env.SRC.put('fixed/corrected_transcript.json', JSON.stringify(doc));

      return new Response('Done');
    }

    return new Response('Worker up. POST /rotate or GET /download');
  }
};

/* -------- helpers ------------------------------------------------------- */

function extractAngle(page) {
  if (!page.transforms?.length) return 0;
  const { rows, cols, data } = page.transforms[0];
  // data is base-64-encoded float64[]
  const buf = Uint8Array.from(atob(data), c => c.charCodeAt(0)).buffer;
  const view = new DataView(buf);
  const a = view.getFloat64(0, true);       // cosθ
  const b = view.getFloat64(8, true);       // sinθ
  const deg = Math.round((Math.atan2(b, a) * 180) / Math.PI);
  return snapTo90(deg);
};

function snapTo90(deg) { return Math.round(deg / 90) * 90; }

// Remove existing rotation metadata
async function normalizeRotation(bytes) {
  const pdf = await PDFDocument.load(bytes);

  for (let i = 0; i < pdfDoc.getPageCount(); i++) {
    pdf.getPage(i).setRotation(degrees(0));
  }

  return await newPdf.save({ useObjectStreams: true });
}

async function rotatePdf(bytes, angles) {
  const pdf = await PDFDocument.load(bytes);
  angles.forEach((deg, i) =>
    pdf.getPage(i).setRotation(degrees(-deg))   // pdf-lib API
  );
  return pdf.save({ useObjectStreams: true });
}

async function buildJWT(email, pkcs8) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: email,
    sub: email,
    aud: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    iat: now,
    exp: now + 3600,
  };
  const encode = obj =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unsigned = `${encode(header)}.${encode(payload)}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    str2ab(pkcs8),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${arrayBufferToBase64URL(sig)}`;
}

// Helpers for encoding
function str2ab(str) {
  const pem = str.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const binary = atob(pem);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
  return buf.buffer;
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function arrayBufferToBase64URL(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Load service account from Wrangler secrets
async function getServiceAccountFromEnv(env) {
  try {
    const saJson = env.GCP_SA_KEY ? JSON.parse(env.GCP_SA_KEY) : null;
    if (saJson) return saJson;
    if (env.SRC) {
      const saObj = await env.SRC.get('secret/service_account.json');
      if (saObj) return await saObj.json();
    }
    return null;
  } catch (e) {
    console.warn('Failed to load service account JSON from secrets', e);
    return null;
  }
}

