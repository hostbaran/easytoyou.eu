# IonCube Decoder Automation

## Prerequisites
- Install Node.js (includes npm).

## Setup
- Install dependencies using Node.js (from the project root):
  - `npm install`
- Open `decode.js` and update the `const CONFIG` object with your source, destination, temp download paths, credentials, and progress file location.

## Run
- Execute the decoder:
  - `node decode.js`
- The script will:
  - Create needed directories.
  - Copy non-PHP and non-encoded PHP files into the `destDir`.
  - Submit encoded PHP files one-by-one to the decode site, download results, and track progress.

## Retry missing decodes
- To resubmit files that were not decoded (e.g., timeouts or crashes), run:
  - `node fix_missing_files.js`
