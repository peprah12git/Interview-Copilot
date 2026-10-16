// test/classifier.test.js
// Run with:  node test/classifier.test.js
// Verifies question classification, including the QA type, and that every
// classification type has a prompt that embeds the profile exactly once.

const { classify, buildPrompts } = require('../classifier');

let passed = 0;
let failed = 0;

function expectType(question, expected) {
  const actual = classify(question);
  if (actual === expected) { passed++; }
  else { failed++; console.error(`  ✗ "${question}"\n      expected ${expected}, got ${actual}`); }
}

// ── QA: derived from the AI quality assurance / evaluation job description ──
expectType('How would you design test cases to validate AI outputs against defined requirements?', 'qa');
expectType('How do you document test cases and scenarios?', 'qa');
expectType('Have you reviewed or annotated data sets to improve model training accuracy?', 'qa');
expectType('How do you label data consistently across several annotators?', 'qa');
expectType('How do you evaluate model predictions and spot inconsistencies or errors?', 'qa');
expectType('How do you maintain organized records of your test results?', 'qa');
expectType('What testing methodologies would you use for an AI-driven system?', 'qa');
expectType('What is the difference between smoke testing and regression testing?', 'qa');
expectType('Write a bug report for a login page that crashes. What severity would you give it?', 'qa');
expectType('How would you handle hallucination in model output?', 'qa');
expectType('What is the QA process you follow on a project?', 'qa');
expectType('What is your experience with Selenium or Cypress?', 'qa');

// ── Existing types must be unaffected ──
expectType('Implement a function to reverse a linked list and state the time complexity', 'coding');
expectType('Explain overfitting and how dropout and regularization help', 'ml');
expectType('Explain how a neural network learns using gradient descent', 'ml');
expectType('Tell me about a time you had a conflict with a teammate', 'behavioural');
expectType('What is your favourite colour?', 'general');

// ── Prompts: QA prompt exists and the profile is injected exactly once ──
const prompts = buildPrompts('CANDIDATE PROFILE:\nName: Test Person');
for (const type of ['coding', 'behavioural', 'ml', 'qa', 'general', 'screen']) {
  if (typeof prompts[type] !== 'string' || !prompts[type]) {
    failed++; console.error(`  ✗ missing prompt for ${type}`);
    continue;
  }
  const count = prompts[type].split('CANDIDATE PROFILE:').length - 1;
  if (count === 1) passed++;
  else { failed++; console.error(`  ✗ profile appears ${count}x in ${type} prompt`); }
}
if (/Suggested response/.test(prompts.qa)) passed++;
else { failed++; console.error('  ✗ qa prompt lacks no-fabrication guidance'); }

console.log(`\nClassifier tests — PASSED: ${passed}   FAILED: ${failed}`);
process.exit(failed ? 1 : 0);
