#!/usr/bin/env node
// Test cron detection patterns - comprehensive coverage

const testCases = [
  // Natural language with action verbs
  { msg: "send me the 2028 election odds on polymarket every minute", shouldMatch: true },
  { msg: "notify me about market changes every hour", shouldMatch: true },
  { msg: "alert me when bitcoin hits $50k every day", shouldMatch: true },
  { msg: "check the weather every 5 minutes", shouldMatch: true },
  { msg: "monitor bitcoin price for me", shouldMatch: true },
  { msg: "update me on stock prices every hour", shouldMatch: true },
  { msg: "fetch latest news every morning", shouldMatch: true },
  { msg: "get me the odds every few minutes", shouldMatch: true },
  { msg: "pull data every 30 seconds", shouldMatch: true },
  { msg: "retrieve market data hourly", shouldMatch: true },
  
  // "Keep me" patterns
  { msg: "keep me updated on the election", shouldMatch: true },
  { msg: "keep me informed about price changes", shouldMatch: true },
  { msg: "keep me posted every hour", shouldMatch: true },
  { msg: "keep track of bitcoin for me", shouldMatch: true },
  { msg: "keep an eye on polymarket odds", shouldMatch: true },
  { msg: "keep tabs on the price", shouldMatch: true },
  
  // "Let me know" patterns
  { msg: "let me know if the price changes every minute", shouldMatch: true },
  { msg: "let me know about updates regularly", shouldMatch: true },
  { msg: "inform me every hour about changes", shouldMatch: true },
  
  // Monitoring/watching
  { msg: "watch for price changes", shouldMatch: true },
  { msg: "watch out for market updates", shouldMatch: true },
  { msg: "stay on top of election odds", shouldMatch: true },
  { msg: "stay informed about the markets", shouldMatch: true },
  { msg: "follow bitcoin prices closely", shouldMatch: true },
  { msg: "observe the market continuously", shouldMatch: true },
  
  // "I want/need" patterns
  { msg: "i want updates every hour", shouldMatch: true },
  { msg: "i need to check prices daily", shouldMatch: true },
  { msg: "i would like notifications every minute", shouldMatch: true },
  { msg: "i want to monitor this regularly", shouldMatch: true },
  
  // Time-based patterns
  { msg: "check at 9am every day", shouldMatch: true },
  { msg: "send updates at 3:30pm", shouldMatch: true },
  { msg: "notify me every morning", shouldMatch: true },
  { msg: "check every evening", shouldMatch: true },
  { msg: "update me every night", shouldMatch: true },
  
  // Frequency adverbs
  { msg: "regularly check the price for me", shouldMatch: true },
  { msg: "periodically send me updates", shouldMatch: true },
  { msg: "continuously monitor the market", shouldMatch: true },
  { msg: "constantly check for changes", shouldMatch: true },
  { msg: "repeatedly notify me of updates", shouldMatch: true },
  { msg: "check prices routinely", shouldMatch: true },
  
  // Interval patterns
  { msg: "check at 5 minute intervals", shouldMatch: true },
  { msg: "send updates on an hourly basis", shouldMatch: true },
  { msg: "on a daily basis, check the odds", shouldMatch: true },
  
  // Automation patterns
  { msg: "automate checking polymarket prices", shouldMatch: true },
  { msg: "set up automatic price monitoring", shouldMatch: true },
  { msg: "set up automated updates every hour", shouldMatch: true },
  { msg: "create a recurring task to check prices", shouldMatch: true },
  
  // Reminder patterns
  { msg: "remind me every hour to check prices", shouldMatch: true },
  { msg: "set a reminder every day at 9am", shouldMatch: true },
  { msg: "daily reminder to check markets", shouldMatch: true },
  
  // Explicit cron mentions
  { msg: "create a cron job to check markets", shouldMatch: true },
  { msg: "add a cron job every 5 minutes", shouldMatch: true },
  { msg: "schedule a task to run hourly", shouldMatch: true },
  
  // SHOULD NOT MATCH - one-time or non-recurring
  { msg: "what's the weather today", shouldMatch: false },
  { msg: "check the price right now", shouldMatch: false },
  { msg: "send me the current odds", shouldMatch: false },
  { msg: "what time is it", shouldMatch: false },
  { msg: "tell me about bitcoin", shouldMatch: false },
];

const cronPatterns = [
  // Explicit cron mentions
  /\bcron\s+job\b/i,
  /\bcron\s+add\b/i,
  /\bcreate.*cron/i,
  /\bschedule.*task/i,
  /\bschedule.*job/i,
  /\brecurring.*task/i,
  /\bautomated.*task/i,
  /\bset.*reminder/i,
  /\bruns?\s+every\b/i,
  
  // Time frequency patterns
  /\bevery\s+\d*\s*(second|minute|hour|day|week|month|year)/i,
  /\bevery\s+(few|couple|other)\s+(seconds?|minutes?|hours?|days?)/i,
  /\beach\s+\d*\s*(minute|hour|day|week|month)/i,
  
  // Action verbs + "every"
  /\b(send|notify|alert|tell|inform|ping|message|email|text)\s+(me|us)?\s*.*\bevery\b/i,
  /\b(check|monitor|watch|track|scan|poll|query|fetch|get|pull|retrieve)\s*.*\bevery\b/i,
  /\b(update|report|notify|alert|show|give|provide|share)\s+(me|us)?\s*.*\bevery\b/i,
  
  // "Keep me" patterns
  /\bkeep\s+(me|us)\s+(updated|informed|notified|posted|in\s+the\s+loop)/i,
  /\bkeep\s+(track|tabs|an\s+eye)\s+(of|on)/i,
  
  // "Let me know" patterns
  /\blet\s+(me|us)\s+know.*\b(every|when|if)/i,
  /\binform\s+(me|us).*\b(every|regularly|periodically)/i,
  
  // Monitoring/watching
  /\bmonitor\s+(this|that|the|it|\w+)\s+(for\s+me|regularly|continuously)?/i,
  /\bwatch\s+(for|out\s+for).*\b(changes?|updates?)/i,
  /\bstay\s+(on\s+top\s+of|informed|updated)/i,
  /\bfollow\s+.*\b(regularly|closely)/i,
  /\bobserve\s+.*\b(continuously|regularly)/i,
  
  // "I want/need" patterns
  /\bi\s+(want|need|would\s+like).*\bevery\b/i,
  /\bi\s+(want|need|would\s+like).*\b(daily|hourly|weekly|regularly)/i,
  
  // Update/notification requests
  /\b(get|receive|have)\s+(updates?|notifications?|alerts?).*\b(every|regular|periodic)/i,
  /\bnotify.*\b(every|when|if).*\b(minute|hour|day|changes?)/i,
  
  // Time-based triggers
  /\bdaily\s+(at|by|trigger|run|send|notify|check|update)/i,
  /\bhourly\s+(trigger|run|send|notify|check|update)/i,
  /\bweekly\s+(trigger|run|send|notify|check|update)/i,
  /\bmonthly\s+(trigger|run|send|notify|check|update)/i,
  /\bat\s+\d+\s*(am|pm|:\d+)/i,
  /\bevery\s+(morning|evening|night|noon)/i,
  
  // Frequency adverbs
  /\b(regularly|periodically|continuously|constantly|repeatedly|routinely)\s+(check|send|notify|update|monitor)/i,
  /\b(check|send|notify|update|monitor).*\b(regularly|periodically|continuously|constantly|repeatedly)/i,
  
  // Interval patterns
  /\bat\s+\d+\s+(minute|hour|day)\s+intervals?/i,
  /\bon\s+an?\s+(hourly|daily|weekly|regular|periodic)\s+basis/i,
  
  // "Make sure" / "Ensure" patterns
  /\b(make\s+sure|ensure|see\s+to\s+it)\s+.*\b(every|regularly|continuously)/i,
  
  // Automation indicators
  /\bautomate.*\b(checking|monitoring|sending|notifying)/i,
  /\bset\s+up.*\b(automatic|automated|recurring)/i,
  
  // Reminder patterns
  /\bremind\s+(me|us).*\bevery\b/i,
  /\breminder.*\b(every|daily|hourly|weekly)/i,
];

function detectCronRequest(message) {
  const lowerMessage = message.toLowerCase();
  return cronPatterns.some(pattern => pattern.test(lowerMessage));
}

console.log('🧪 Testing Cron Detection Patterns\n');
console.log('═'.repeat(60));

let passed = 0;
let failed = 0;

testCases.forEach(({ msg, shouldMatch }) => {
  const detected = detectCronRequest(msg);
  const isCorrect = detected === shouldMatch;
  
  if (isCorrect) {
    passed++;
  } else {
    failed++;
    console.log(`\n❌ FAILED:`);
    console.log(`   Message: "${msg}"`);
    console.log(`   Expected: ${shouldMatch ? 'MATCH' : 'NO MATCH'}`);
    console.log(`   Got: ${detected ? 'MATCH' : 'NO MATCH'}`);
  }
});

console.log('\n' + '═'.repeat(60));
console.log(`\n✅ Passed: ${passed}/${testCases.length}`);
console.log(`❌ Failed: ${failed}/${testCases.length}`);
console.log(`📊 Success Rate: ${((passed/testCases.length)*100).toFixed(1)}%`);

if (failed === 0) {
  console.log('\n🎉 All tests passed!\n');
} else {
  console.log('\n⚠️  Some tests failed. Review the patterns above.\n');
  process.exit(1);
}

// Show some examples of what works
console.log('\n' + '═'.repeat(60));
console.log('📝 Example Messages That Work:\n');
const examples = testCases.filter(t => t.shouldMatch).slice(0, 10);
examples.forEach(({ msg }) => {
  console.log(`   ✓ "${msg}"`);
});
console.log('\n' + '═'.repeat(60) + '\n');
