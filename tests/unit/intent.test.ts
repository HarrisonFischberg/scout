// General question or page question? (owner request 2026-10-21)
import { describe, expect, it } from "vitest";
import { classifyQuestion, isSearchResultsPage, pageWords } from "../../src/chat/intent";
import { SUMMARIZE_QUESTION } from "../../src/chat/prompt";
import { SHOPPING_SUGGESTIONS } from "../../src/panel/suggestions";

const HOME_DEPOT = pageWords("Toilets - The Home Depot", "https://www.homedepot.com/b/Bath-Toilets/N-5yc1vZbxav");
const on = (question: string, extra: Partial<Parameters<typeof classifyQuestion>[0]> = {}) =>
  classifyQuestion({ question, pageTitle: HOME_DEPOT, ...extra });

describe("classifyQuestion", () => {
  it("answers the owner's example as a general question: coffee shops while on a Home Depot toilets page", () => {
    expect(on("What's the best coffee shop in Noe Valley?")).toBe("general");
    expect(on("best coffee shop in X neighborhood")).toBe("general");
  });

  it.each([
    "Who won the World Series last year?",
    "How many milligrams of vitamin D should an adult take?",
    "What's the weather in Chicago this weekend?",
    "Good brunch spots near here?",
    "Write a haiku about autumn",
    "What time does Trader Joe's close today?",
    "How do I convert Celsius to Fahrenheit?",
    "Plan a 3 day trip to Lisbon this summer",
    "Is that coffee shop open late?",
  ])("general: %s", (q) => {
    expect(on(q, { previous: "general" })).toBe("general");
  });

  it.each([
    "Summarize this page",
    "How much is it?",
    "How much does this one cost?",
    "How much is the widget?",
    "Is this toilet worth it?",
    "Which of these toilets uses the least water?",
    "Is it in stock?",
    "What does this say about installation?",
    "Explain this",
    "Where can I buy this?",
    "What are the reviews saying on this page?",
    "What's the cheapest toilet here?",
    "Compare the elongated ones on the page",
    "Do they deliver toilets for free?",
    "tl;dr",
  ])("page: %s", (q) => {
    expect(on(q)).toBe("page");
  });

  it("treats Summarize, Explain and the shopping suggestions as page questions", () => {
    expect(on(SUMMARIZE_QUESTION)).toBe("page");
    expect(on("Explain the most important points on this page.")).toBe("page");
    for (const s of SHOPPING_SUGGESTIONS) expect(on(s.prompt)).toBe("page");
  });

  it("counts words the question shares with the page title or address", () => {
    expect(on("Which toilet brand is most reliable?")).toBe("page");
    expect(classifyQuestion({ question: "Which toilet brand is most reliable?", pageTitle: "Espresso machines | Example" })).toBe("general");
  });

  it("does not read 'this weekend' or 'near here' as the page", () => {
    expect(on("Any concerts this weekend?")).toBe("general");
    expect(on("Coffee near here that opens at 6?")).toBe("general");
  });

  it("keeps the topic for a short follow-up", () => {
    expect(on("and what about Mission?", { previous: "general" })).toBe("general");
    expect(on("what about the reviews?", { previous: "page" })).toBe("page");
    expect(on("is it worth it?", { previous: "page" })).toBe("page");
    // After a general answer, "it" means that answer, not the page.
    expect(on("is it open on Sundays?", { previous: "general" })).toBe("general");
    // "this page" always means the page.
    expect(on("ok, now summarize this page", { previous: "general" })).toBe("page");
  });

  it("treats a message with attached tabs as a page question", () => {
    expect(on("Which is cheaper?", { attachedTabs: 1 })).toBe("page");
  });

  it("is general with no page at all", () => {
    expect(classifyQuestion({ question: "Best ramen in Tokyo?" })).toBe("general");
    expect(classifyQuestion({ question: "   " })).toBe("general");
  });
});

describe("search results pages", () => {
  const GOOGLE = pageWords("Hannah Marie Kelly - Google Search", "https://www.google.com/search?q=Hannah+Marie+Kelly");

  it("does not treat the user's own search words as a page question", () => {
    expect(isSearchResultsPage("https://www.google.com/search?q=Hannah+Marie+Kelly")).toBe(true);
    expect(isSearchResultsPage("https://duckduckgo.com/?q=coffee")).toBe(true);
    expect(isSearchResultsPage("https://www.bing.com/search?q=coffee")).toBe(true);
    expect(isSearchResultsPage("https://maps.google.com/maps/place/x")).toBe(false);
    expect(isSearchResultsPage("https://www.google.com/")).toBe(false);
    expect(isSearchResultsPage("https://www.homedepot.com/s/toilets?q=toilet")).toBe(false);
    expect(
      classifyQuestion({
        question: "I'm looking for Hannah Marie Kelly, and the song has something about the words smile on your face",
        pageTitle: GOOGLE,
      }),
    ).toBe("general");
  });

  it("still sends the page when the message points at it", () => {
    expect(classifyQuestion({ question: "Which of these results is official?", pageTitle: GOOGLE })).toBe("page");
    expect(classifyQuestion({ question: "summarize the results here", pageTitle: GOOGLE })).toBe("page");
  });
});

describe("pageWords", () => {
  it("joins the title and the address path", () => {
    expect(HOME_DEPOT).toContain("Toilets - The Home Depot");
    expect(HOME_DEPOT).toContain("Bath Toilets");
    expect(pageWords(undefined, "not a url")).toBe("");
  });
});
