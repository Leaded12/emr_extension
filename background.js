// background.js (Manifest V3, with "type": "module")

// 1. Import Tesseract from an ESM build
//    Make sure you actually have "tesseract.esm.js" in "libs/" or use your own bundler.
import Tesseract from './libs/tesseract.esm.min.js';

// The rest is your logic from before, adapted to remove importScripts

// 2. Replicate your parameter map, validation, etc.:
const parametersMap = {
  "Creatinine": ["Creatinine"],
  "eGFR": ["eGFR", "Glomerular Filtration Rate"],
  "Potassium": ["Potassium", "K+"],
  "Bicarb": ["Carbon Dioxide", "CO2", "Bicarb"],
  "Intact PTH": ["Intact PTH", "PTH"],
  "Vitamin D": ["Vitamin D"],
  "Urine Protein": ["Urine Protein", "Protein, Urine"],
  "Urine Creatinine": ["Urine Creatinine", "Creatinine, Urine"],
  "Urine Albumin": ["Urine Albumin", "Albumin, Urine"],
  "Hemoglobin": ["Hemoglobin", "Hgb"],
  "Iron": ["Iron"],
  "TIBC": ["TIBC", "Total Iron Binding Capacity"],
  "Ferritin": ["Ferritin"]
};

const validationRanges = {
  "Creatinine": [0.5, 5.0],
  "eGFR": [0, 150],
  "Potassium": [2.5, 6.5],
  "Bicarb": [10, 40],
  "Intact PTH": [0, 150],
  "Vitamin D": [10, 100],
  "Urine Protein": [0, 300],
  "Urine Creatinine": [0, 300],
  "Hemoglobin": [5, 20],
  "Iron": [10, 300],
  "TIBC": [100, 600],
  "Ferritin": [10, 1000]
};

const parameterFormats = {
  "Creatinine": /^\d+\.\d{2}$/,
  "eGFR": /^\d{2}$/,
  "Potassium": /^\d+\.\d$/,
  "Bicarb": /^\d{2}$/,
  "Intact PTH": /^\d{2}$/,
  "Vitamin D": /^\d{2}\.\d$/,
  "Urine Protein": /^\d{2}\.\d$/,
  "Urine Creatinine": /^\d{2}\.\d$/,
  "Hemoglobin": /^\d{2}\.\d$/,
  "Iron": /^\d{2}$/
  // etc...
};

// Fuzzy partial ratio (a naive approach in plain JS)
function partialRatio(str1, str2) {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();
  if (s1.includes(s2)) {
    return 100; 
  }
  // If not a direct substring, do a naive overlap count
  const overlap = Math.min(s1.length, s2.length);
  let matches = 0;
  for (let i = 0; i < overlap; i++) {
    if (s1[i] === s2[i]) matches++;
  }
  return Math.round((matches / overlap) * 100);
}

function cleanText(txt) {
  return txt.replace(/[^a-zA-Z0-9., ]/g, '').trim();
}

function validateNumericValue(param, value) {
  if (parameterFormats[param] && !parameterFormats[param].test(value)) {
    return false;
  }
  const num = parseFloat(value);
  if (validationRanges[param]) {
    const [minVal, maxVal] = validationRanges[param];
    if (num < minVal || num > maxVal) {
      return false;
    }
  }
  return true;
}

/**
 * Create a Tesseract worker for a single image OCR
 */
async function ocrImage(blob) {
  const worker = await Tesseract.createWorker({
    // If you see errors about "Cannot load core.wasm",
    // you might need to set workerPath / corePath with `chrome.runtime.getURL()`.
    // Example:
    // workerPath: chrome.runtime.getURL('libs/tesseract.worker.js'),
    // corePath: chrome.runtime.getURL('libs/tesseract-core.wasm'),
    // logger: m => console.log(m),
  });

  await worker.loadLanguage('eng');
  await worker.initialize('eng');
  await worker.setParameters({
    tessedit_pageseg_mode: '6'
  });

  const { data: { text } } = await worker.recognize(blob);
  await worker.terminate();
  return text;
}

/**
 * Analyze all images for a given patient
 */
async function analyzePatientImages(patientId) {
  const url = `https://njkidneydoctors.emnemr.com/ci/paper/sign2/8/4/${patientId}`;
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Failed to fetch images page for ${patientId}`);
  }
  const html = await response.text();

  // Parse out <img src="..."> in top-to-bottom order
  const imgRegex = /<img\s[^>]*src=["']([^"']+)["'][^>]*>/g;
  let match;
  const imageUrls = [];
  while ((match = imgRegex.exec(html)) !== null) {
    imageUrls.push(match[1]);
  }

  // Initialize results
  const results = {};
  for (const param of Object.keys(parametersMap)) {
    results[param] = [];
  }

  // We'll do parallel with Promise.all
  // But be aware if there are many images, this can be CPU-heavy
  const ocrPromises = imageUrls.map(async (partialUrl) => {
    // Full URL
    const fullUrl = `https://njkidneydoctors.emnemr.com${partialUrl}`;
    const imgResp = await fetch(fullUrl, { credentials: 'include' });
    if (!imgResp.ok) {
      console.warn(`Image fetch failed: ${fullUrl}`);
      return;
    }
    const blob = await imgResp.blob();

    // OCR
    const text = await ocrImage(blob);

    // Parameter extraction
    const lines = text.split('\n');
    const foundParameters = new Set();
    for (let line of lines) {
      line = cleanText(line);
      for (const [param, aliases] of Object.entries(parametersMap)) {
        if (results[param].length >= 6) continue;
        if (foundParameters.has(param)) continue;

        // Fuzzy match
        for (const alias of aliases) {
          const score = partialRatio(line, alias);
          if (score > 80) {
            // extract numbers
            const numbers = line.match(/\b\d+\.\d+|\b\d+\b/g);
            if (numbers) {
              for (const number of numbers) {
                if (validateNumericValue(param, number)) {
                  results[param].push(number);
                  foundParameters.add(param);
                  break;
                }
              }
            }
            if (foundParameters.has(param)) {
              break;
            }
          }
        }
        if (foundParameters.has(param)) {
          break;
        }
      }
    }
  });

  await Promise.all(ocrPromises);

  // Deduplicate
  for (const param of Object.keys(results)) {
    results[param] = [...new Set(results[param])];
  }
  return results;
}

// Listen for analyze request
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'analyzeImages') {
    const { patientId } = msg;
    analyzePatientImages(patientId)
      .then((res) => {
        sendResponse({ success: true, data: res });
      })
      .catch((err) => {
        console.error(err);
        sendResponse({ success: false, error: err.toString() });
      });
    return true; // keep channel open for async response
  }
});
