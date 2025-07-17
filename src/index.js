import { PDFDocument, degrees } from 'pdf-lib';

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    // Download corrected PDF for local test
    if (pathname === '/download') {
      try {
        const pdfObj = await env.SRC.get('fixed/corrected_transcript.pdf');
        if (!pdfObj) return new Response('Fixed PDF not found in R2', { status: 404 });

        const pdfBytes = await pdfObj.arrayBuffer();
        return new Response(pdfBytes, {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'attachment; filename="corrected_transcript.pdf"',
          },
        });
      } catch (err) {
        console.error('❌ PDF download failed:', err);
        return new Response('Internal Server Error', { status: 500 });
      }
    }

    if (pathname === '/rotate') {
      try {
        console.log('🔄 Starting PDF rotation task');

        const pdfObj = await env.SRC.get('raw/transcript3.pdf');
        if (!pdfObj) return new Response('PDF not found in R2', { status: 404 });
        const pdfBytes = await pdfObj.arrayBuffer();

        const saObj = await env.SRC.get('secret/service_account.json');
        if (!saObj) return new Response('Service account not found', { status: 500 });
        const serviceAccountJSON = await saObj.json();

        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: await getGoogleJWT(serviceAccountJSON),
          }),
        });

        const tokenData = await tokenRes.json();
        const accessToken = tokenData.access_token;
        if (!accessToken) throw new Error('Failed to get access token');

        const docAIRes = await fetch(
          `https://us-documentai.googleapis.com/v1/projects/${env.GCP_PROJECT_ID}/locations/${env.GCP_LOCATION}/processors/${env.GCP_PROCESSOR_ID}:process`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
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
        const pages = doc.document?.pages || [];

        // Prepare array of angles for each page
        const angles = [];
        pages.forEach((p, i) => {
			console.log(`Processing page ${i + 1} with layout:`, p.layout?.orientation);
			// Fallback: use Document AI's transform if available
			console.log(`Processing page ${i + 1} with transforms:`, p.transforms);
			const transform = p.transforms?.[0];
			if (transform && transform.data) {
				try {
				const decoded = atob(transform.data);
				const view = new DataView(Uint8Array.from(decoded, c => c.charCodeAt(0)).buffer);
				const a = view.getFloat32(0, true);
				const b = view.getFloat32(4, true);
				const rawAngle = Math.atan2(b, a) * (180 / Math.PI);
				angles.push(snapAngle((Math.round(rawAngle) + 360) % 360));
				} catch (e) {
				console.warn(`⚠️ Failed to decode transform for page ${i + 1}:`, e);
				angles.push(0);
				}
			} else {
				angles.push(0);
			}
        });

        // Flatten rotation: copy content to new PDF and apply rotation
        const fixedPdfBytes = await rotateAndFlatten(pdfBytes, angles);

        await env.SRC.put(
          'fixed/corrected_transcript.pdf',
          fixedPdfBytes,
          { httpMetadata: { contentType: 'application/pdf' } }
        );

        await env.SRC.put(
          'fixed/corrected_transcript.json',
          JSON.stringify(doc),
          { httpMetadata: { contentType: 'application/json' } }
        );

        return new Response('✅ Rotated and saved PDF');
      } catch (err) {
        console.error('❌ PDF rotation failed:', err);
        return new Response('Internal Server Error', { status: 500 });
      }
    }

    return new Response('Worker running. Call /rotate to process PDF, /download to download the fixed PDF.');
  },
};

// Snap angle to nearest cardinal direction (0, 90, 180, 270, 360)
function snapAngle(angle) {
  const candidates = [0, 90, 180, 270, 360];
  let closest = candidates.reduce((prev, curr) =>
    Math.abs(curr - angle) < Math.abs(prev - angle) ? curr : prev
  );
  return closest;
}

// Flatten rotation: copy content to new PDF and apply rotation
async function rotateAndFlatten(pdfBytes, angles) {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const newPdf = await PDFDocument.create();

  for (let i = 0; i < pdfDoc.getPageCount(); i++) {
	const page = pdfDoc.getPage(i);
	const rotationDegrees = page.getRotation().angle; // This gives the rotation in degrees (0, 90, 180, 270)
  	console.log(`Page ${i + 1} rotation: ${rotationDegrees}°`);
  
    const [copiedPage] = await newPdf.copyPages(pdfDoc, [i]);
    const angle = angles[i] || 0;
	console.log(`Rotating page ${i + 1} by ${angle} degrees`);
    copiedPage.setRotation(degrees(-angle));
    newPdf.addPage(copiedPage);
  }

  return await newPdf.save({ useObjectStreams: true });
}

async function getGoogleJWT(serviceAccountJSON) {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };

  const payload = {
    iss: serviceAccountJSON.client_email,
    sub: serviceAccountJSON.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    iat: now,
    exp: now + 3600,
  };

  const encoder = new TextEncoder();
  const base64url = (obj) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unsignedJWT = `${base64url(header)}.${base64url(payload)}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    str2ab(serviceAccountJSON.private_key),
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    encoder.encode(unsignedJWT)
  );

  return `${unsignedJWT}.${arrayBufferToBase64URL(signature)}`;
}

function str2ab(str) {
  const pem = str.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const binary = atob(pem);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
  return buf.buffer;
}

function arrayBufferToBase64URL(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}