# PDF Rotation Worker

This project is a Cloudflare Worker that processes PDF documents stored in R2, applies deterministic page rotations, and saves the corrected results for download. It uses [pdf-lib](https://github.com/Hopding/pdf-lib) for PDF manipulation and Google Document AI for page analysis.

## Features

- **Rotate PDF Pages:** Automatically rotates specified pages of a PDF (e.g., page 1 to 270°, page 3 to 90°) for consistent orientation.
- **Flatten Rotation:** Applies rotation to the actual page content so it appears correct in all PDF viewers.
- **Google Document AI Integration:** Uses Document AI to analyze page transforms (optional/fallback for other pages).
- **R2 Storage:** Reads and writes PDFs and accompanying JSON files to Cloudflare R2 storage.
- **JWT Authentication:** Authenticates with Google APIs using a service account.
- **Download API:** Download the corrected PDF from the worker endpoint.

## API Endpoints

- `GET /rotate`  
  Processes the original PDF, applies rotations, saves the corrected PDF and a JSON report to R2.
- `GET /download`  
  Downloads the corrected PDF (`fixed/corrected_transcript.pdf`) for local testing.
- `GET /`  
  Returns a simple status message.

## Usage

1. **Upload Source Files**
   - Upload your original PDF to R2: `raw/transcript.pdf`
   - Upload your Google service account JSON to R2: `secret/service_account.json`

2. **Run Rotation**
   - Send a GET request to `/rotate`.
   - The worker will:
     - Authenticate with Google,
     - Analyze the PDF using Document AI,
     - Rotate page 1 to 270°, page 3 to 90°, and other pages as needed,
     - Flatten the rotation (so it's visible in all viewers),
     - Save the corrected PDF and Document AI JSON result to R2.

3. **Download Corrected PDF**
   - Send a GET request to `/download`.
   - The worker will return the corrected PDF as an attachment.

## Example

```sh
# Rotate and fix the PDF
curl https://your-worker-url/rotate

# Download the corrected PDF
curl -O -J https://your-worker-url/download
```

## Configuration

Set your environment variables for the worker:

- `GCP_PROJECT_ID` - Google Cloud Project ID
- `GCP_LOCATION` - Document AI processor location (e.g., `us`)
- `GCP_PROCESSOR_ID` - Document AI processor ID

R2 bindings:
- `SRC` - R2 bucket binding for source and destination files

## Dependencies

- [pdf-lib](https://github.com/Hopding/pdf-lib)
- Cloudflare Workers runtime (with R2 binding)
- Google Document AI API access

## Code Structure

- `worker.js` - Main worker code, entry point
- `README.md` - This documentation

## License

MIT

## Notes

- Only the rotation for page 1 (index 0) and page 3 (index 2) is forced by default. Adjust logic as needed.
- If you need to rotate other pages, update the code logic in the rotation array.
- Flattening is done by copying content to new pages and setting rotation, making the output compatible with all PDF viewers.

```
