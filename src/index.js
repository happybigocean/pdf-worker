import { PDFDocument, degrees } from 'pdf-lib';
import { schema } from './schemas/schema.js';

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
        console.log('Fetching extracted transcript JSON from R2...');
        const transcriptFile = await env.SRC.get('fixed/extracted_transcript.json');

        if (!transcriptFile) {
          console.warn('Extracted transcript JSON not found in R2');
          return new Response('Transcript JSON not found', { status: 404 });
        }

        const transcriptBuffer = await transcriptFile.arrayBuffer();
        console.log('Returning extracted transcript JSON');

        return new Response(transcriptBuffer, {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        console.error('Download failed:', err);
        return new Response(`Download error: ${err.message || 'Internal Server Error'}`, { status: 500 });
      }
    }

    /* ---------- Analyze ---------- */
    if (pathname === '/analyze') {
      try {
        console.log('Starting PDF rotation and Document AI analysis...');

        const pdfObj = await env.SRC.get('raw/transcript.pdf');
        if (!pdfObj) {
          console.warn('Raw transcript PDF not found in R2');
          return new Response('PDF not found', { status: 404 });
        }

        const rawPdfBytes = await pdfObj.arrayBuffer();
        console.log('Loaded raw PDF from R2');

        const pdfBytes = await normalizeRotation(rawPdfBytes);
        console.log('Normalized PDF rotation metadata');

        const jwt = await buildJWT(env.GCP_SA_EMAIL, env.GCP_SA_KEY);
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: jwt,
          }),
        });

        const tokenJson = await tokenRes.json();
        if (!tokenRes.ok || !tokenJson.access_token) {
          console.error('Token fetch failed:', tokenJson);
          return new Response(`Token error: ${tokenJson.error_description || tokenJson.error || 'Unknown error'}`, {
            status: 500,
          });
        }

        const access_token = tokenJson.access_token;
        console.log('Access token acquired');

        const docAIRes = await fetch(
          `https://us-documentai.googleapis.com/v1/projects/${env.GCP_PROJECT_ID}/locations/${env.GCP_LOCATION}/processors/${env.GCP_OCR_ID}:process`,
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
        if (!doc || !doc.document) {
          console.error('OCR response error:', doc);
          return new Response(`OCR failed: ${doc.error?.message || 'Unexpected format'}`, { status: 500 });
        }

        console.log('OCR processor response received');

        const angles = (doc.document?.pages || []).map(extractAngle);
        console.log('Rotation angles extracted:', angles);

        const fixedBytes = await rotatePdf(pdfBytes, angles);
        console.log('Applied rotation correction');

        await env.SRC.put('fixed/corrected_transcript.pdf', fixedBytes, {
          httpMetadata: { contentType: 'application/pdf' },
        });

        const transcriptAIRes = await fetch(
          `https://us-documentai.googleapis.com/v1/projects/${env.GCP_PROJECT_ID}/locations/${env.GCP_LOCATION}/processors/${env.GCP_EXTRACT_ID}:process`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              rawDocument: {
                content: arrayBufferToBase64(fixedBytes),
                mimeType: 'application/pdf',
              },
              fieldMask: 'entities',
            }),
          }
        );

        const transcriptJsonRaw = await transcriptAIRes.json();
        if (!transcriptJsonRaw || !transcriptJsonRaw.document) {
          console.error('Transcript extraction error:', transcriptJsonRaw);
          return new Response(`Extraction failed: ${transcriptJsonRaw.error?.message || 'Invalid structure'}`, {
            status: 500,
          });
        }

        console.log('Transcript AI extraction complete');

        const data = transcriptJsonRaw.document;
        const entityMap = buildEntityMap(data?.entities);
        const formattedTranscript = extractBySchema(schema, entityMap);
        console.log('Transcript reformatted into target schema');

        await env.SRC.put('fixed/extracted_transcript.json', JSON.stringify(formattedTranscript));
        console.log('Formatted transcript saved to R2');

        return new Response('Done');
      } catch (err) {
        console.error('Analyze failed:', err);
        return new Response(`Analyze error: ${err.message || 'Internal Server Error'}`, { status: 500 });
      }
    }

    // Default response for unmatched paths
    return new Response('Worker up. POST /analyze or GET /download');
  },
};

/* -------- helpers ------------------------------------------------------- */
// Recursive function to build the full JSON object
function buildJsonObject(data) {
  let result = {};

  if (data.entities) {
    const entities = data.entities || [];
    entities.forEach(entity => {
      if (entity.type) {
        // Create an object for each entity type
        let newValue = '';
        if (entity?.properties) {
          newValue = buildJsonObject({entities: entity.properties});
        } else {
          newValue = entity.mentionText || '';  // Use mentionText if available
        }

        if (!result[entity.type]) {
          result[entity.type] = newValue;  // Assign directly if not already set
        } else {
          // If the type is repeated, make sure we store it in an array
          if (Array.isArray(result[entity.type])) {
            result[entity.type].push(newValue);
          } else {
            let currentValue = result[entity.type];
            result[entity.type] = [currentValue];  // Convert to array if not already
            result[entity.type].push(newValue);
          }
        }
      }
    });
  }

  return result;
}

function extractBySchema(schema, entitiesMap) {
  if (schema.type === "OBJECT") {
    const result = {};

    // Handle merging from array of objects into one object
    if (Array.isArray(entitiesMap)) {
      entitiesMap.forEach((item) => {
        if (typeof item === "object" && item !== null) {
          for (const key in schema.properties) {
            if (!(key in result)) {
              const value = extractBySchema(schema.properties[key], item[key]);
              if (value !== undefined) {
                result[key] = value;
              }
            }
          }
        }
      });
    } else if (entitiesMap && typeof entitiesMap === "object") {
      for (const key in schema.properties) {
        const propSchema = schema.properties[key];
        const value = extractBySchema(propSchema, entitiesMap[key]);

        if (value !== undefined) {
          result[key] = value;
        }
      }
    } else {
      return undefined;
    }

    // ✅ Check required fields
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!(key in result)) {
          return undefined; // drop object if required field is missing
        }
      }
    }

    return Object.keys(result).length > 0 ? result : undefined;
  }

  if (schema.type === "ARRAY") {
    let dataArray = [];

    if (entitiesMap && typeof entitiesMap === "object" && !Array.isArray(entitiesMap)) {
      dataArray = [entitiesMap];
    } else if (Array.isArray(entitiesMap)) {
      dataArray = entitiesMap;
    } else {
      return undefined;
    }

    const arrayResult = dataArray
      .map((item) => extractBySchema(schema.items, item))
      .filter((v) => v !== undefined); // skip invalid or incomplete

    return arrayResult.length > 0 ? arrayResult : undefined;
  }

  // Base case: primitive
  if (
    typeof entitiesMap === "string" ||
    typeof entitiesMap === "number" ||
    typeof entitiesMap === "boolean"
  ) {
    return entitiesMap;
  }

  if (entitiesMap && typeof entitiesMap === "object" && "mentionText" in entitiesMap) {
    return entitiesMap.mentionText;
  }

  return undefined;
}

function buildEntityMap(entities = []) {
  const map = {};

  for (const entity of entities) {
    if (!entity?.type) continue;

    const key = entity.type;

    const value = entity.properties
      ? buildEntityMap(entity.properties) // Recurse into nested properties
      : entity;

    if (!map[key]) {
      map[key] = value;
    } else if (Array.isArray(map[key])) {
      map[key].push(value);
    } else {
      map[key] = [map[key], value];
    }
  }

  return map;
}

function extractAngle(page) {
  if (!page.transforms?.length) return 0;
  const { rows, cols, data } = page.transforms[0];
  const buf = Uint8Array.from(atob(data), c => c.charCodeAt(0)).buffer;
  const view = new DataView(buf);
  const a = view.getFloat64(0, true);  // cosθ
  const b = view.getFloat64(8, true);  // sinθ
  const deg = Math.round((Math.atan2(b, a) * 180) / Math.PI);
  return snapTo90(deg);
}

function snapTo90(deg) {
  return Math.round(deg / 90) * 90;
}

async function normalizeRotation(bytes) {
  const pdf = await PDFDocument.load(bytes);
  for (let i = 0; i < pdf.getPageCount(); i++) {
    pdf.getPage(i).setRotation(degrees(0));
  }
  return await pdf.save({ useObjectStreams: true });
}

async function rotatePdf(bytes, angles) {
  const pdf = await PDFDocument.load(bytes);
  angles.forEach((deg, i) =>
    pdf.getPage(i).setRotation(degrees(-deg))
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
