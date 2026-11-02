// Starter questions on the app's empty chat (owner request 2026-11-02): four
// fresh ones on every launch and every new chat, picked at random from a
// built-in pool so there is no extra API call, cost or wait. Questions that
// need today's facts are only offered when Claude (with web search) answers;
// Apple's on-device model cannot look things up.

export interface Starter {
  text: string;
  topic: string;
  /** Needs a web search for a good answer. */
  web?: boolean;
}

export const STARTER_COUNT = 4;
export const LAST_STARTERS_KEY = "scout.app.lastStarters";

export const STARTERS: readonly Starter[] = [
  // Food
  { topic: "food", text: "What's a good 20-minute dinner?" },
  { topic: "food", text: "What can I cook with eggs, rice and spinach?" },
  { topic: "food", text: "Give me a simple weekly meal plan" },
  { topic: "food", text: "How do I make a really good omelette?" },
  { topic: "food", text: "What's an easy dessert for guests?" },
  { topic: "food", text: "How long do leftovers keep in the fridge?" },
  // Money
  { topic: "money", text: "Explain how mortgages work" },
  { topic: "money", text: "How does compound interest work?" },
  { topic: "money", text: "Help me make a simple monthly budget" },
  { topic: "money", text: "What's the difference between a Roth and a traditional IRA?" },
  { topic: "money", text: "How do credit scores work?" },
  { topic: "money", text: "Should I pay off debt or save first?" },
  // Writing
  { topic: "writing", text: "Help me write a thank-you note" },
  { topic: "writing", text: "Write a polite email declining an invitation" },
  { topic: "writing", text: "Help me write a birthday message for a friend" },
  { topic: "writing", text: "Make this email sound more professional" },
  { topic: "writing", text: "Write a short toast for a wedding" },
  { topic: "writing", text: "Help me write a cover letter" },
  // Learning
  { topic: "learn", text: "Explain how vaccines work, simply" },
  { topic: "learn", text: "Why is the sky blue?" },
  { topic: "learn", text: "How do airplanes stay in the air?" },
  { topic: "learn", text: "Explain AI like I'm ten" },
  { topic: "learn", text: "What caused the fall of Rome?" },
  { topic: "learn", text: "How does the stock market work?" },
  { topic: "learn", text: "Teach me a useful word in Spanish" },
  { topic: "learn", text: "How do black holes form?" },
  // Health
  { topic: "health", text: "Give me a 15-minute workout with no equipment" },
  { topic: "health", text: "Tips for falling asleep faster" },
  { topic: "health", text: "How much water should I drink a day?" },
  { topic: "health", text: "Suggest a stretching routine for desk work" },
  { topic: "health", text: "What are some healthy snacks?" },
  // Home
  { topic: "home", text: "How do I get a stain out of a shirt?" },
  { topic: "home", text: "How often should I water a houseplant?" },
  { topic: "home", text: "Help me plan a weekend clean of my home" },
  { topic: "home", text: "How do I fix a running toilet?" },
  { topic: "home", text: "Tips for decluttering a closet" },
  // Travel
  { topic: "travel", text: "Plan a 3-day trip to Chicago" },
  { topic: "travel", text: "What should I pack for a beach weekend?" },
  { topic: "travel", text: "Tips for beating jet lag" },
  { topic: "travel", text: "Ideas for a road trip with kids" },
  // Fun
  { topic: "fun", text: "Suggest a good book for this weekend" },
  { topic: "fun", text: "Give me a fun fact I've never heard" },
  { topic: "fun", text: "Plan a game night for six friends" },
  { topic: "fun", text: "Ideas for a rainy day at home" },
  { topic: "fun", text: "Tell me a riddle" },
  { topic: "fun", text: "Recommend a movie like Inception" },
  // Work
  { topic: "work", text: "How do I ask for a raise?" },
  { topic: "work", text: "Help me prepare for a job interview" },
  { topic: "work", text: "Tips for running a better meeting" },
  { topic: "work", text: "How can I stop procrastinating?" },
  // Gifts and people
  { topic: "people", text: "Gift ideas for my mom under $50" },
  { topic: "people", text: "Ideas for a first date" },
  { topic: "people", text: "How do I start a hard conversation kindly?" },
  { topic: "people", text: "Plan a kid's birthday party" },
  // Today (web search)
  { topic: "today", web: true, text: "What happened in the news today?" },
  { topic: "today", web: true, text: "What's the weather this weekend?" },
  { topic: "today", web: true, text: "What are the best new movies out now?" },
  { topic: "today", web: true, text: "What's new in tech this week?" },
  { topic: "today", web: true, text: "Who won the big game last night?" },
];

/**
 * Picks `count` starters from different topics, at most one needing the web,
 * avoiding the ones shown last time where the pool allows.
 */
export function pickStarters(
  opts: { web: boolean; avoid?: readonly string[]; count?: number },
  random: () => number = Math.random,
): string[] {
  const count = opts.count ?? STARTER_COUNT;
  const avoid = new Set(opts.avoid ?? []);
  const pool = STARTERS.filter((s) => opts.web || !s.web);
  const fresh = shuffle(pool.filter((s) => !avoid.has(s.text)), random);
  const seen = shuffle(pool.filter((s) => avoid.has(s.text)), random);
  const picked: Starter[] = [];
  const topics = new Set<string>();
  // First pass: one per topic. Second pass: fill if topics ran out.
  for (const s of [...fresh, ...seen]) {
    if (picked.length === count) break;
    if (topics.has(s.topic)) continue;
    picked.push(s);
    topics.add(s.topic);
  }
  for (const s of [...fresh, ...seen]) {
    if (picked.length === count) break;
    if (!picked.includes(s)) picked.push(s);
  }
  return picked.map((s) => s.text);
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
