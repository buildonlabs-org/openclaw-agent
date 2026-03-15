// Test the response cleanup function

function cleanupCronResponse(response) {
  if (!response || typeof response !== 'string') {
    return response;
  }
  
  let cleaned = response;
  
  // Replace variations of "to [your/the] specified webhook URL" with just "here"
  cleaned = cleaned.replace(/to (your|the) specified webhook URL/gi, 'here');
  cleaned = cleaned.replace(/to the webhook URL/gi, 'here');
  cleaned = cleaned.replace(/to webhook URL/gi, 'here');
  
  // Remove entire lines or sections mentioning webhook URL with actual URL
  // This catches "Webhook URL: https://..." on its own line
  cleaned = cleaned.replace(/^Webhook URL:.*$/gim, '');
  cleaned = cleaned.replace(/^- Webhook URL:.*$/gim, '');
  cleaned = cleaned.replace(/^\*\*Webhook URL\*\*:.*$/gim, '');
  
  // Remove webhook URL if it appears inline with https://
  cleaned = cleaned.replace(/Webhook URL:\s*https?:\/\/[^\s\n]+/gi, '');
  cleaned = cleaned.replace(/webhook URL:\s*https?:\/\/[^\s\n]+/gi, '');
  
  // Remove sentences that end with colon before webhook URL line
  // e.g., "...will be sent to your specified webhook URL:" -> "...will be sent here."
  cleaned = cleaned.replace(/will be sent to (your|the) specified webhook URL:\s*$/gim, 'will be sent here.');
  
  // Clean up any extra blank lines that might have been created
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  
  // Trim any trailing whitespace
  cleaned = cleaned.trim();
  
  return cleaned;
}

// Test cases
const testResponse = `The cron job to fetch the Polymarket 2028 election odds every minute has been successfully created. Completion notifications will be sent to your specified webhook URL:

Webhook URL: https://polymarket-trader-production-378a.up.railway.app/api/openclaw-cron-webhook

Let me know if you need anything else!`;

const expectedOutput = `The cron job to fetch the Polymarket 2028 election odds every minute has been successfully created. Completion notifications will be sent here.

Let me know if you need anything else!`;

console.log('=== INPUT ===');
console.log(testResponse);
console.log('\n=== CLEANED OUTPUT ===');
const cleaned = cleanupCronResponse(testResponse);
console.log(cleaned);
console.log('\n=== EXPECTED OUTPUT ===');
console.log(expectedOutput);
console.log('\n=== MATCH ===');
console.log(cleaned === expectedOutput ? '✅ PASS' : '❌ FAIL');

// Additional test cases
console.log('\n\n=== Additional Test Cases ===\n');

const test2 = `Cron job created with webhook URL: https://example.com/webhook`;
console.log('Test 2 Input:', test2);
console.log('Test 2 Output:', cleanupCronResponse(test2));
console.log('Expected: Cron job created with');

const test3 = `Setup complete.

Details:
- Name: Test Job
- Webhook URL: https://example.com/api/webhook
- Schedule: Every hour`;

console.log('\nTest 3 Input:', test3);
console.log('Test 3 Output:', cleanupCronResponse(test3));
console.log('Expected: No webhook URL line');
