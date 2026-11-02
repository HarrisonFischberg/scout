// Starter questions on the app's empty chat (owner request 2026-11-02): four
// fresh ones on every launch and every new chat, picked at random from a
// built-in pool of about 120 so there is no extra API call, cost or wait. Questions that
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
  // More (owner asked for about 120, 2026-11-02)
  { topic: "food", text: "What's a quick, healthy lunch for work?" },
  { topic: "food", text: "How do I cook perfect rice?" },
  { topic: "food", text: "Give me a vegetarian dinner idea" },
  { topic: "food", text: "What can I make with chicken and potatoes?" },
  { topic: "food", text: "How do I make cold brew coffee?" },
  { topic: "food", text: "What's a good breakfast I can make ahead?" },
  { topic: "money", text: "How do index funds work?" },
  { topic: "money", text: "What's a good way to save for a vacation?" },
  { topic: "money", text: "How do I read a pay stub?" },
  { topic: "money", text: "Explain what inflation is" },
  { topic: "money", text: "Is it better to rent or buy a home?" },
  { topic: "money", text: "How do I lower my monthly bills?" },
  { topic: "writing", text: "Help me write a get-well-soon card" },
  { topic: "writing", text: "Write a short bio for my profile" },
  { topic: "writing", text: "Help me reply to a tricky text" },
  { topic: "writing", text: "Write a polite complaint to a company" },
  { topic: "writing", text: "Help me write an apology message" },
  { topic: "writing", text: "Make my resume summary stronger" },
  { topic: "learn", text: "How does the internet actually work?" },
  { topic: "learn", text: "Why do we dream?" },
  { topic: "learn", text: "How do solar panels work?" },
  { topic: "learn", text: "Explain the electoral college" },
  { topic: "learn", text: "How did the pyramids get built?" },
  { topic: "learn", text: "Why do cats purr?" },
  { topic: "learn", text: "How does memory work in the brain?" },
  { topic: "learn", text: "What's the difference between weather and climate?" },
  { topic: "health", text: "How can I build a habit that sticks?" },
  { topic: "health", text: "Easy ways to walk more each day" },
  { topic: "health", text: "How do I start running as a beginner?" },
  { topic: "health", text: "What's a simple way to lower stress?" },
  { topic: "health", text: "How much sleep do I really need?" },
  { topic: "health", text: "Ideas for drinking less caffeine" },
  { topic: "home", text: "How do I clean a cast-iron pan?" },
  { topic: "home", text: "Easy plants that are hard to kill" },
  { topic: "home", text: "How do I hang a picture straight?" },
  { topic: "home", text: "How do I unclog a drain without chemicals?" },
  { topic: "home", text: "Ways to make a small room feel bigger" },
  { topic: "home", text: "How do I lower my energy bill at home?" },
  { topic: "travel", text: "Plan a weekend in New York City" },
  { topic: "travel", text: "How do I find cheap flights?" },
  { topic: "travel", text: "Tips for a long flight" },
  { topic: "travel", text: "What should I see in Paris in two days?" },
  { topic: "travel", text: "How do I travel with only a carry-on?" },
  { topic: "travel", text: "Ideas for a cozy fall weekend getaway" },
  { topic: "fun", text: "Suggest a hobby I can start this week" },
  { topic: "fun", text: "Give me a fun trivia question" },
  { topic: "fun", text: "Recommend a podcast for my commute" },
  { topic: "fun", text: "What's a good board game for two?" },
  { topic: "fun", text: "Write me a short funny poem" },
  { topic: "fun", text: "Ideas for a fun picnic" },
  { topic: "work", text: "How do I write a good LinkedIn post?" },
  { topic: "work", text: "Tips for working from home" },
  { topic: "work", text: "How do I say no to extra work politely?" },
  { topic: "work", text: "Help me set goals for this month" },
  { topic: "work", text: "How do I give helpful feedback?" },
  { topic: "people", text: "Gift ideas for a coworker under $25" },
  { topic: "people", text: "Ways to make new friends as an adult" },
  { topic: "people", text: "Ideas for a fun anniversary" },
  { topic: "people", text: "How do I help a friend who's going through a hard time?" },
  { topic: "people", text: "Fun things to do with grandparents" },
  { topic: "today", web: true, text: "What's happening in sports this week?" },
  { topic: "today", web: true, text: "What are the top stories in business today?" },
  { topic: "today", web: true, text: "Any big events happening this weekend?" },
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
