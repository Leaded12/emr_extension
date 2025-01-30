// content.js

(function() {
  // Attempt to find the anchor
  // We'll do a generic query that matches "ptchart/info/<number>"
  const anchor = document.querySelector('a[href^="ptchart/info/"]');
  if (anchor) {
    // href looks like "ptchart/info/739"
    const href = anchor.getAttribute('href');
    // Extract the ID
    const match = href.match(/^ptchart\/info\/(\d+)/);
    if (match) {
      const patientId = match[1];

      // We can store this in a global var or use the chrome runtime sendMessage
      // so the background can keep track. Or do nothing until the popup asks us for it.
      // Let's store it in session storage so popup can read it easily.

      chrome.runtime.sendMessage({
        action: 'storePatientId',
        patientId
      });
    }
  }
})();
