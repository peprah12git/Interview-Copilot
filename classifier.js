// NOTE: The candidate profile is NO LONGER hard-wired here. It is supplied
// dynamically at prompt-build time by the profile service (see buildPrompts in
// index.js), so answers always reflect the user's currently saved CV. The
// confidential interview-answering instructions below are kept separate from
// candidate data, as required.

// Prepended to every system prompt so the model always answers as the candidate.
// Written generically (no hardcoded name/employer) so it works for any profile.
const BASE_INSTRUCTION =
  'You are a real-time interview assistant for the candidate described above. ' +
  'When answering interview questions, reference ONLY the candidate\'s actual ' +
  'projects, skills, education, certifications, and experience as given in the ' +
  'CANDIDATE PROFILE above. ' +
  'Do NOT invent, assume, or exaggerate any employer, role, project, qualification, ' +
  'certification, or technical skill that is not present in the profile. ' +
  'If the profile does not contain enough information to answer a question honestly, ' +
  'do not fabricate personal experience — instead give an honest answer and, where ' +
  'useful, clearly label a block as "Suggested response:" that the candidate can adapt. ' +
  'Never mention you are an AI. Speak in the first person as the candidate.';

// Builds a single system prompt string: [profile text] + [base instruction] +
// [per-type instruction lines]. `profileText` is injected ONCE here, so callers
// must NOT also embed the profile in their lines (avoids duplication).
function withProfile(profileText, ...lines) {
  return [profileText, BASE_INSTRUCTION, ...lines].join('\n\n');
}

// Per-type instruction lines, kept free of any candidate-specific references so
// they remain correct for every user's profile. These are combined with the
// live profile text by buildPrompts().
const PROMPT_INSTRUCTIONS = {
  coding: [
    'For this coding question:',
    '1. Briefly explain your approach before writing code.',
    '2. Write clean, working code using a language from the candidate\'s skill set — whichever fits best.',
    '3. State the time and space complexity.',
    '4. Mention any important edge cases, drawing on the candidate\'s real projects where relevant.',
  ],

  behavioural: [
    'CRITICAL: This is a live interview. The candidate reads and speaks the answer at the same time.',
    'Rules that must never be broken:',
    '- Every answer must be readable in under 60 seconds.',
    '- No long paragraphs. Short, punchy sentences only.',
    '- Maximum 5-6 bullet points per answer, each one line long.',
    '- Use simple present or past tense. No filler phrases.',
    '',
    'For "tell me about yourself" or "introduce yourself", use EXACTLY this 5-bullet structure:',
    '• Who I am and current role',
    '• Where I studied',
    '• One key project I built (name it, state what it does in one line)',
    '• My core technical strengths (list 4-5 technologies)',
    '• What I am looking for next',
    '',
    'Base every bullet strictly on the CANDIDATE PROFILE above. If a detail is not in',
    'the profile, omit that bullet rather than inventing content.',
    '',
    'For all other behavioural questions, use the STAR format but compressed:',
    '• Situation: one line',
    '• Task: one line',
    '• Action: two lines max — what you actually did, referencing the candidate\'s real projects/employers',
    '• Result: one line with a concrete outcome',
    '',
    'Always draw ONLY from the real experience listed in the profile. If the profile',
    'lacks a relevant example, say so honestly and offer a clearly labelled',
    '"Suggested response:" the candidate can adapt — never fabricate experience.',
  ],

  ml: [
    'For this ML/AI question:',
    '1. Give a clear, jargon-free explanation of the concept.',
    '2. Provide a concrete real-world example, ideally connecting it to the candidate\'s actual experience when the profile supports it.',
    '3. Mention key trade-offs or limitations if relevant.',
  ],

  general: [
    'Give a clear, confident, well-structured answer.',
    'Where possible, ground your answer in the candidate\'s actual experience from the profile above.',
    'Be concise but complete. Use bullet points for multi-part answers.',
  ],

  // Used for screen captures — the model adapts its own response style.
  screen: [
    'Look at this screenshot and identify the interview question or problem.',
    'First state the question in one sentence, then answer it fully as the candidate.',
    'If it is a coding problem: give approach, code (in a language from the profile), and complexity.',
    'If it is behavioural: use STAR format with real examples from the candidate\'s profile.',
    'If it is ML/AI: explain clearly with a real-world example.',
    'Never invent experience that is not in the profile.',
  ],
};

// Build the full PROMPTS map for a given live profile text. Called on startup
// and again whenever the active profile changes, so prompts always reflect the
// current CV without an app restart.
function buildPrompts(profileText) {
  const prompts = {};
  for (const [type, lines] of Object.entries(PROMPT_INSTRUCTIONS)) {
    prompts[type] = withProfile(profileText, ...lines);
  }
  return prompts;
}

const CODING_KEYWORDS = [
  'implement', 'write a function', 'write code', 'algorithm', 'complexity',
  'data structure', 'array', 'string', 'linked list', 'tree', 'graph',
  'stack', 'queue', 'heap', 'hash map', 'hash table', 'binary search',
  'sort', 'sorted', 'recursion', 'recursive', 'dynamic programming', ' dp ',
  'bfs', 'dfs', 'traverse', 'reverse', 'rotate', 'fibonacci', 'palindrome',
  'anagram', 'substring', 'subarray', 'matrix', 'two pointer', 'sliding window',
  'time complexity', 'space complexity', 'o(n)', 'o(log', 'big o',
  'leetcode', 'codility', 'hackerrank', 'debug', 'refactor', 'optimise', 'optimize',
];

const ML_KEYWORDS = [
  'machine learning', 'neural network', 'deep learning', 'artificial intelligence',
  'model', 'training', 'overfitting', 'underfitting', 'gradient descent',
  'backpropagation', 'loss function', 'feature engineering', 'feature selection',
  'classification', 'regression', 'clustering', 'nlp', 'natural language',
  'transformer', 'attention mechanism', 'bert', 'gpt', 'llm', 'large language',
  'cnn', 'rnn', 'lstm', 'reinforcement learning', 'supervised', 'unsupervised',
  'cross entropy', 'precision', 'recall', 'f1 score', 'confusion matrix',
  'bias variance', 'regularization', 'dropout', 'embedding', 'tokenization',
  'fine-tuning', 'inference', 'hyperparameter', 'epoch', 'batch size',
  'learning rate', 'activation function', 'relu', 'sigmoid', 'softmax',
];

const BEHAVIOURAL_KEYWORDS = [
  'tell me about', 'tell me a time', 'describe a time', 'give me an example',
  'give an example', 'have you ever', 'how do you handle', 'how have you',
  'walk me through', 'what would you do', 'greatest strength', 'greatest weakness',
  'weakness', 'strength', 'challenge', 'difficult situation', 'conflict',
  'team', 'leadership', 'deadline', 'failure', 'success', 'proud of',
  'motivated', 'collaborate', 'disagreed', 'feedback', 'learned from',
  'mistake', 'improve yourself', 'work under pressure', 'prioritize',
];

function classify(text) {
  const lower = text.toLowerCase();

  const score = (keywords) =>
    keywords.reduce((n, kw) => n + (lower.includes(kw) ? 1 : 0), 0);

  const scores = {
    coding:      score(CODING_KEYWORDS),
    ml:          score(ML_KEYWORDS),
    behavioural: score(BEHAVIOURAL_KEYWORDS),
  };

  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : 'general';
}

module.exports = { classify, buildPrompts, BASE_INSTRUCTION, PROMPT_INSTRUCTIONS };
