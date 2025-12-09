# IonCube Decoder Automation

## Prerequisites
- Install Node.js (includes npm).

## Setup
- From the project root, install dependencies:
  - `npm install`
- Open `decode.js` and update the `const CONFIG` object with:
  - `sourceDir`, `destDir`, `downloadDir`
  - `username`, `password`
  - `loginUrl`, `decoderUrl`
  - `progressFile`, `maxRetries`, `delayBetweenFiles`

## Run
- Start the decoder:
  - `node decode.js`
- The script will:
  - Create needed directories.
  - Copy non-PHP and non-encoded PHP files into `destDir`.
  - Send encoded PHP files one-by-one to the decode site, download results, and track progress.

## Retry missing decodes
- To resubmit files that were not decoded (e.g., timeouts or crashes), run:
  - `node fix_missing_files.js`

## Donate
- If you wish to support, add your wallets below:
  - USDT (BEP20): `0x992c4b9ad54cf990d74bbfa248c4329a2402bd15`
