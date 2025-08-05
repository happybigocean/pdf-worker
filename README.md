# PDF Rotation & Transcript Extraction Worker

## 🔁 /analyze (POST)
- Loads raw/transcript.pdf from R2.
- Clears all rotation metadata from the PDF.
- Runs OCR using Google Document AI OCR Processor.
- Detects and corrects rotated pages.
- Saves corrected PDF to fixed/corrected_transcript.pdf in R2.
- Sends the corrected PDF to the Transcript Extraction Processor.
- Reformats extracted entities using a JSON schema (schemas/schema.js).
- Saves the final structured JSON to fixed/extracted_transcript.json.

## ⬇️ /download (GET)

- Streams the fixed/extracted_transcript.json file from R2.

## 📦 Requirements
- GCP_SA_EMAIL: Google service account email
- GCP_SA_KEY: Google service account private key (PKCS#8)
- GCP_PROJECT_ID: GCP project ID
- GCP_LOCATION: GCP region (e.g. us)
- GCP_OCR_ID: OCR processor ID
- GCP_EXTRACT_ID: Extraction processor ID

## 🧠 How it Works

1. Rotates and normalizes the original PDF.
2. Sends to Document AI OCR to extract page orientation.
3. Applies rotation correction.
4. Sends to Document AI Extraction Processor.
5. Validates and maps the response into a custom schema.
6. Saves structured JSON to R2.