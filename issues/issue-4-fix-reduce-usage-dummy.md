---
labels: good first issue, bug
title: Fix `reduce_usage` dummy function logic
---

## Description
In the main contract logic, the `reduce_usage` function currently states that it's a "dummy function for testing." It simply subtracts 1 from the `usage_count` without any advanced validation, and lacks corresponding tests to prove it works under edge cases.

## Task
1. Look at `reduce_usage` in `autoshare_logic.rs`.
2. Add comprehensive validation logic to ensure that usages can only be reduced by authorized users or under correct system states.
3. Update or remove the comment "dummy function for testing" once it is production-ready.

## Expected Outcome
A pull request implementing the proper logic for `reduce_usage` and ensuring tests pass.
