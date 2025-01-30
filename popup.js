// popup.js

document.addEventListener('DOMContentLoaded', async () => {
  const analyzeBtn = document.getElementById('analyzeBtn');
  const resultsDiv = document.getElementById('results');

  let cachedPatientId = null;

  // We can request the patient ID from the content script
  // Or we can rely on the content script having already told the background script.
  // Let's do a quick approach: ask the active tab for the ID. We'll do so by sending a message to the content script.

  function getPatientIdFromContentScript() {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs.length > 0) {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'getPatientId' }, (response) => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError.message);
              return;
            }
            if (response && response.patientId) {
              resolve(response.patientId);
            } else {
              reject('No patient ID found');
            }
          });
        } else {
          reject('No active tabs found');
        }
      });
    });
  }

  // But recall in content.js, we did "sendMessage({ action: 'storePatientId', patientId })",
  // so let's also set up a listener to store that globally in background. 
  // For simplicity here, let's just do the "getPatientId" approach.

  analyzeBtn.addEventListener('click', async () => {
    resultsDiv.textContent = 'Analyzing... Please wait.';
    resultsDiv.classList.remove('error');

    // First get the patient ID
    try {
      const pid = await getPatientIdFromContentScript();
      cachedPatientId = pid;
    } catch (err) {
      resultsDiv.textContent = 'Error getting patient ID: ' + err;
      resultsDiv.classList.add('error');
      return;
    }

    // Now send a message to background to do the analysis
    chrome.runtime.sendMessage(
      { action: 'analyzeImages', patientId: cachedPatientId },
      (response) => {
        if (chrome.runtime.lastError) {
          resultsDiv.textContent = 'Runtime error: ' + chrome.runtime.lastError.message;
          resultsDiv.classList.add('error');
          return;
        }
        if (!response || !response.success) {
          resultsDiv.textContent = 'Error: ' + (response ? response.error : 'No response');
          resultsDiv.classList.add('error');
          return;
        }

        // We have the results dictionary
        const data = response.data; // e.g. { Creatinine: [...], eGFR: [...], etc. }
        // Let's display them nicely in a table:
        let html = '<table><thead><tr><th>Parameter</th><th>Values</th></tr></thead><tbody>';
        for (const [param, values] of Object.entries(data)) {
          html += `<tr><td>${param}</td><td>${values.join(', ')}</td></tr>`;
        }
        html += '</tbody></table>';
        resultsDiv.innerHTML = html;
      }
    );
  });
});

// Also listen for direct content script messages if you prefer
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'storePatientId') {
    // Not strictly necessary if we're using getPatientIdFromContentScript
    // But you could store it in a global variable or something
    // For example: localStorage.setItem('patientId', msg.patientId);
    // Then read from localStorage inside the click handler if desired
  }
});


// content.js (append this at the bottom)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getPatientId') {
    // Let's re-run the anchor parse or if we already found the ID, store it in a global
    const anchor = document.querySelector('a[href^="ptchart/info/"]');
    if (anchor) {
      const href = anchor.getAttribute('href');
      const match = href.match(/^ptchart\/info\/(\d+)/);
      if (match) {
        sendResponse({ patientId: match[1] });
        return true;
      }
    }
    sendResponse({});
    return true;  // let Chrome know we're responding asynchronously if needed
  }
});
