# R4.2 acceptance tests

## A. Context and continuity

1. Context Lite already contains Đà Lạt, 7 people and exact dates. User says
   `Lên chỗ chơi đi`.
   - Must not ask destination, party or dates again.
   - Rapid receives only the bounded micro-brief.

2. New session contains `Chọn 2` but no current decision.
   - Must ask for the option name; must not guess.

3. V1 context contains a full partner directory.
   - Must not forward the full directory to either Brain.
   - Partner discovery uses `search_partner_oa` only when needed.

4. A V2 delta reports a new expense.
   - Merge only the delta and retain confirmed choices/current decision.

## B. Natural intake and Autopilot

5. `Nha Trang 7 người, bạn tự lên luôn đi`.
   - No `BẮT ĐẦU RESEARCH`, no form and no repeated party question.
   - Uses soft assumptions for non-material unknowns.
   - Calls Rapid once and returns useful concepts plus one recommendation.

6. `Đi Nha Trang khoảng 5 triệu/người`.
   - Asks at most three high-information blockers.
   - Gives one combined answer example.

## C. Contextual relevance

7. `Ở Nha Trang có gì chơi cho nhóm mình?`
   - Up to three meaningfully different options.
   - Dynamic experience titles and distinct hero moments.
   - No fixed `CẢNH ĐẸP / VIRAL / KHÁC BIỆT` tags.
   - One group-fit recommendation and one CTA.

8. Only two options are distinctive.
   - Returns two; does not invent a third or expose debug.

9. OA partner search returns three businesses.
   - Directory membership is not treated as quality/price/availability proof.
   - No second web discovery search for the same shortlist.
   - `partner_oa_id` is preserved internally for later inquiry.

## D. Currentness and viability

10. Exact trip date uses an airport affected by closure.
    - Official-first fatal dependency is checked before price.
    - Failed flight option is removed; unclear option is not primary.
    - At most one search and one fetch in Rapid.

11. Stable inspiration without exact route/date.
    - Zero web and zero partner call unless a specific OA shortlist is needed.

12. A listing page exists but exact-date availability is not visible.
    - Availability stays `listing_only|unknown`, never `available_seen`.
    - Link is not described as a verified booking/prefilled link.

## E. Budget and objections

13. Trip budget is 35M for 7 people, transport committed at 5M, stay candidate
    costs 24M.
    - Outcome/Expert reserves mandatory categories first.
    - Candidate is stretch/fail, never primary.

14. User says `35tr mà suggest InterCon hả, tiền đâu mà đi`.
    - Acknowledges the conflict, retracts/downgrades immediately.
    - Does not call Brain only to defend/recheck the price.
    - Returns to stay decision with one realistic CTA.

## F. Group control

15. Current decision is stay; another member says `Hay đi Đà Lạt luôn :))`.
    - Does not reset or research Đà Lạt.
    - Parks the suggestion or asks explicit scope-change confirmation.

16. Members say `Mình thích 1` and `3 đẹp hơn`.
    - Records two preferences, not consensus.
    - Asks for one explicit `CHỐT 1` or `CHỐT 3`.

17. Option 1 is locked; user casually suggests option 2 again.
    - Does not silently reopen.

18. User repeats the same objection with no new fact.
    - No Brain call; summarizes unresolved trade-off once and recommends a
      default.

## G. Custom tools and authority

19. User asks `Tạo chuyến Đà Lạt` but dates are missing.
    - Does not call `create_trip`; asks one material question.

20. User explicitly asks to record an expense with amount/title.
    - Calls `add_expense` once.
    - Claims success only after successful tool result.
    - Does not call `get_trip_state` to verify.

21. User asks `Cuối chuyến ai trả ai?`
    - Calls `settle_expenses`; model does not calculate settlement itself.

22. Group is debating options but did not ask for a vote card.
    - Text selection is default; no automatic `propose_options`.

23. User asks to create a vote card after options are ready.
    - Calls `propose_options` once with 2–4 options and one recommendation.
    - Does not create a second open decision.

24. User chooses an OA and asks to contact it.
    - `draft_oa_inquiry` prepares a message/link; must not claim it was sent.

25. Whole-trip task is deep and can run asynchronously.
    - Calls `request_deep_plan` once, acknowledges naturally and ends turn.
    - Does not also call Expert or wait for the result.

26. `pending_job` already shows the same job running.
    - Does not start a duplicate.

## H. Output and latency

27. Inspiration output is 650–1,100 characters; commercial comparison is
    850–1,400; both remain below 1,800 before URLs and 2,000 total.

28. Output is plain Zalo text: no JSON, markdown table, tool/debug labels or
    unsupported button claim.

29. One turn calls at most one Brain. Normal turns call at most one custom DB
    tool. Partner DB and web are not used for duplicate discovery.

30. Benchmark captures:
    - Outcome route time;
    - Brain/tool time;
    - Outcome render time;
    - total time;
    - input/output token;
    - source calls;
    - UX pass/fail by checksum ID.
