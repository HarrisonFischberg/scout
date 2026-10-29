# iPhone tap-through, QA 2026-10-29

For the build with all QA branches merged. About 20 minutes. Use test pages
and carts only; never place an order. Write down the iPhone model, iOS
version and Scout build (Settings → Diagnostics) at the top of your notes.
If a step fails, tap **Copy diagnostics** on the error (or + → Copy debug
log) and paste it into the thread with the step number.

## Before you start

- Apple Intelligence on (Settings app → Apple Intelligence & Siri).
- Your Anthropic key saved in Scout.
- Two tabs open: a product page from any store, and any news article.

## A. Chat and the Apple-to-Claude handoff

1. On the product page, open Scout and ask **"How much is this?"** Expect a quick answer with the price, and an **Ask Claude** button under it (Apple answered).
2. Tap **Ask Claude**. Expect Claude's answer to replace Apple's, with no duplicate message.
3. New chat, no page: ask **"What is 17 times 23?"** Expect 391 from Apple.
4. New chat: ask **"What's the weather in Denver today?"** Expect it to go straight to Claude with a web source chip (this is the new fix: Apple no longer makes up current facts).
5. Ask something long, then tap **Stop** while it shows "Thinking…". Expect it to stop within a second or two, and nothing saved as a finished answer.
6. Turn on Airplane Mode, ask a page question. Expect a plain error with Copy diagnostics, not an endless spinner. Turn Airplane Mode off.

## B. Scout mode (Control your browser)

7. Open any page with a form (a newsletter or contact form). + → **Scout mode**: **"Fill in the name field with Test Person, but don't submit."** Expect the field filled, other fields unchanged, nothing submitted.
8. Ask Scout mode to **log in** or **pay** on any site. Expect it to stop and ask you first; tap no.
9. Start a Scout mode task, swipe Scout closed, reopen it. Expect the same task still shown with its progress, and no second copy started.
10. Start a task and tap **Stop**. Expect the glow and pill to disappear right away.

## C. Find coupons

11. Add one cheap item to a cart on a store you trust, open the cart, + → **Find coupons**. Expect codes tested one by one, then either "best code … applied" with old and new totals, or "none lowered your total, so your cart is unchanged".
12. Check the store's own cart total matches what Scout said.
13. Run it again and, while codes are being tested, change the quantity in the cart. Expect a message that the cart changed and your own codes put back, not a savings claim.
14. Make sure no visible tabs opened while it read coupon sites.

## D. Phone layout and accessibility

15. Rotate to landscape and back during an answer. Expect nothing cut off or hidden under the keyboard or notch.
16. Settings app → Display → Dark Mode: Scout follows. Switch back.
17. Settings app → Accessibility → Larger Text, drag up two steps. Expect Scout's text larger and buttons still tappable.
18. VoiceOver on (triple-click side button if set up): swipe through Scout's top bar and the + menu. Expect each button read with a name. Turn VoiceOver off.
19. Lock the phone during an answer, unlock, reopen Scout. Expect the answer finished or clearly stopped, never stuck.

## Not covered here

OpenAI (not used), iPad, private browsing, and turning the extension off and on in Settings → Safari → Extensions (optional: try it after step 19 and confirm Scout opens normally).
