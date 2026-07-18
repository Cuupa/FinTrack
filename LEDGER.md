# Ledger — round 2026-07-18b (closed 2026-07-18)

Previous round 2026-07-18a closed and preserved in git history (467e9b9).

## LLM assistant: refusals + register (user report, prod screenshot)
- [x] 1. General finance questions now in scope: replaced the "using ONLY the JSON data below" rule with grounded-portfolio + concept-questions rules; "Never refuse a question merely because the answer is not in the JSON" (8aba823)
- [x] 2. Register rule added to the system prompt: German = informal du (never Sie), Spanish = informal tú (8aba823)
- [x] 3. Missing figures (e.g. beta before the benchmark fetch lands) now answered with "not available in the current snapshot" + concept explanation instead of a refusal
- [x] 4. No-investment-advice line kept verbatim; tests updated (llm-context.test.ts: scope + register assertions), 566 tests + lint green
- [~] 5. Behavioral verification deferred: needs prod redeploy + the user's own API key (local dev has no key). Note: prod may also predate 914ceeb, which is what puts beta/alpha into the chat context at all.
