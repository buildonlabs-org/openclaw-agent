// Test the response cleanup function

function cleanupCronResponse(response) {
  if (!response || typeof response !== 'string') {
    return response;
  }
  
  let cleaned = response;
  
  // Replace "to the specified webhook URL" with just "here"
  cleaned = cleaned.replace(/to the specified webhook URL/gi, 'here');
  cleaned = cleaned.replace(/to the webhook URL/gi, 'here');
  cleaned = cleaned.replace(/to webhook URL/gi, 'here');
  
  // Remove lines that show "Webhook URL: ..." 
  cleaned = cleaned.replace(/^Webhook URL:.*$/gim, '');
  cleaned = cleaned.replace(/^- Webhook URL:.*$/gim, '');
  cleaned = cleaned.replace(/^\*\*Webhook URL\*\*:.*$/gim, '');
  
  // Remove webhook URL if it appears inline with https://
  cleaned = cleaned.replace(/Webhook URL:\s*https?:\/\/[^\s\n]+/gi, '');
  cleaned = cleaned.replace(/webhook URL:\s*https?:\/\/[^\s\n]+/gi, '');
  
  // Clean up any extra blank lines that might have been created
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  
  // Trim any trailing whitespace
  cleaned = cleaned.trim();
  
  return cleaned;
}

// Test cases
const testResponse = `I've set up a cron job to fetch the 2028 presidential election odds from Polymarket every minute. It will send completion notifications to the specified webhook URL.

Here are the details:

Job Name: Polymarket 2028 Presidential Election Odds
Schedule: Every minute
Webhook URL: https://polymarket-trader-production-378a.up.railway.app/api/openclaw-cron-webhook

If you need any further assistance, let me know!`;

const expectedOutput = `I've set up a cron job to fetch the 2028 presidential election odds from Polymarket every minute. It will send completion notifications here.

Here are the details:

Job Name: Polymarket 2028 Presidential Election Odds
Schedule: Every minute

If you need any further assistance, let me know!`;

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
