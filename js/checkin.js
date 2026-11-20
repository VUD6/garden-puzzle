// Daily gift: pure cycle/date/reward logic (Node-testable, no DOM) plus a
// small self-contained DOM controller for the menu button and its popup.
// Rewards are always credited through the helpers module (Garden.helpers) -
// this file never writes charge storage directly.
(function (root) {
  const Platform = root.Garden.platform;
  const AudioFx = root.Garden.audio;

  const CYCLE_LENGTH = 7;

  // Days 1, 2, 3, 5, 6 each grant 1 charge of a fixed helper, by rotation;
  // day 4 and day 7 (below) are handled separately. Any day not listed here
  // and not 4 or 7 doesn't exist in a 7-day cycle, so this covers every
  // "plain" day.
  const ROTATION_HELPER_BY_DAY = { 1: 'finder', 2: 'random', 3: 'snowman', 5: 'finder', 6: 'random' };
  const ROTATION_AMOUNT = 1;

  const DAY4 = 4;
  const DAY4_AMOUNT = 3; // of whichever eligible helper the player has fewest charges of
  const DAY7 = 7;
  const DAY7_AMOUNT = 3; // of EACH helper - the big prize

  const HELPER_NAME_KEY = { finder: 'helperNameFinder', random: 'helperNameRandom', snowman: 'helperNameSnowman' };

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  // "Today" is always the player's LOCAL calendar date - built from local
  // date parts (getFullYear/getMonth/getDate), never from a UTC view of
  // the clock.
  function dateKeyFromParts(year, month, day) {
    return year + '-' + pad2(month + 1) + '-' + pad2(day);
  }

  function dateKeyFromDate(date) {
    return dateKeyFromParts(date.getFullYear(), date.getMonth(), date.getDate());
  }

  // Day difference between two 'YYYY-MM-DD' calendar dates, computed from
  // UTC anchors of the date *parts* (Date.UTC(y, m, d)) rather than by
  // dividing a millisecond difference between real local Date objects -
  // that division breaks across a DST boundary (a local day can be 23 or
  // 25 real hours long), while a pure calendar-date UTC anchor never has a
  // notion of time-of-day or DST at all, so the diff is always exactly in
  // whole days.
  function daysBetweenKeys(fromKey, toKey) {
    const [fy, fm, fd] = fromKey.split('-').map(Number);
    const [ty, tm, td] = toKey.split('-').map(Number);
    const fromUTC = Date.UTC(fy, fm - 1, fd);
    const toUTC = Date.UTC(ty, tm - 1, td);
    return Math.round((toUTC - fromUTC) / 86400000);
  }

  // Same DST-safe UTC-anchor approach as daysBetweenKeys, just moving a
  // calendar date forward (or backward) by a number of days instead of
  // diffing two of them. Used by the debug day-jump helpers below.
  function advanceDateKey(dateKey, days) {
    const [y, m, d] = dateKey.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
    return dateKeyFromParts(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
  }

  function getTodayKey() {
    return dateKeyFromDate(Platform.now());
  }

  // Position after the next claim, given the last-claimed position (0 if
  // never claimed): 0 -> 1, 1 -> 2, ..., 6 -> 7, 7 -> 1 (wraps - "after day
  // 7 the cycle starts again from day 1"). Missing days never resets this:
  // it only ever depends on the LAST position claimed, never on how many
  // calendar days passed since then - that's what makes a gap "pause
  // instead of reset."
  function nextPositionAfter(position) {
    return position === 0 ? 1 : (position % CYCLE_LENGTH) + 1;
  }

  // Among the given helper ids, the one with the fewest current charges;
  // ties favor the id earliest in the list (callers always pass finder
  // first, so a tie favors finder, as specified).
  function fewestChargesAmong(ids) {
    const Helpers = root.Garden.helpers;
    let best = ids[0];
    let bestCharges = Helpers.getCharges(best);
    for (let i = 1; i < ids.length; i++) {
      const charges = Helpers.getCharges(ids[i]);
      if (charges < bestCharges) {
        best = ids[i];
        bestCharges = charges;
      }
    }
    return best;
  }

  // Snowman never receives a reward before it's unlocked (level 10, see
  // Garden.helpers.isUnlocked) - redirected to whichever of Finder/Random
  // the player currently has fewer charges of instead, so nothing is
  // wasted. Any other helper id passes through unchanged.
  function resolveHelperId(id) {
    if (id !== 'snowman') return id;
    if (root.Garden.helpers.isUnlocked('snowman')) return 'snowman';
    return fewestChargesAmong(['finder', 'random']);
  }

  function day4EligibleHelpers() {
    return root.Garden.helpers.isUnlocked('snowman') ? root.Garden.helpers.HELPER_IDS.slice() : ['finder', 'random'];
  }

  // A new cycle's reward *types* (day 3's rotation slot, day 4's
  // fewest-charges pick, and each of day 7's three slots) are decided once,
  // right when the cycle starts, and frozen in the save for the whole
  // 7-day cycle (see computeClaim/rewardForDay below) - otherwise the
  // preview would keep reshuffling itself as charges change from claiming
  // earlier days in the very same cycle. Always computed from CURRENT
  // charges/unlock state at the moment it's called - callers only call this
  // exactly once per cycle, right as it starts.
  function computePlan() {
    return {
      day3Helper: resolveHelperId(ROTATION_HELPER_BY_DAY[3]),
      day4Helper: fewestChargesAmong(day4EligibleHelpers()),
      day7Helpers: root.Garden.helpers.HELPER_IDS.map(resolveHelperId),
    };
  }

  // Whether claiming from `prevPosition` starts a brand new cycle (never
  // claimed before, or wrapping from day 7 back to day 1) - the exact
  // moment a fresh plan needs to be computed and frozen.
  function isNewCycleStart(prevPosition) {
    return nextPositionAfter(prevPosition) === 1;
  }

  // The reward a given cycle day (1-7) grants. `plan` (optional) is the
  // frozen, once-per-cycle set of reward-type decisions from computePlan -
  // when given, day 3/4/7 use it instead of recomputing against CURRENT
  // charges/unlock state, so a day's planned reward can never change
  // mid-cycle just because an earlier day's claim shifted the charge
  // counts. Without a plan (no cycle in progress yet), falls back to a
  // live "what would this grant right now" computation - used by claim()
  // only for the very first claim of a cycle (which is also what computes
  // the plan to freeze), and by the popup's preview before any cycle has
  // ever started.
  //
  // Returns a list of { helperId, amount } credits - normally just one,
  // but day 7 always returns exactly 3 (one per helper's own slot); if
  // Snowman is locked, two of those entries can end up with the same
  // helperId (its slot redirected to Finder or Random) rather than being
  // merged into one bigger amount - every credit always carries the same,
  // consistent per-slot amount.
  function rewardForDay(day, plan) {
    if (day === DAY7) {
      const ids = plan && plan.day7Helpers ? plan.day7Helpers : root.Garden.helpers.HELPER_IDS.map(resolveHelperId);
      return ids.map(function (id) {
        return { helperId: id, amount: DAY7_AMOUNT };
      });
    }

    if (day === DAY4) {
      const helperId = plan && plan.day4Helper ? plan.day4Helper : fewestChargesAmong(day4EligibleHelpers());
      return [{ helperId, amount: DAY4_AMOUNT }];
    }

    const rotationHelper = ROTATION_HELPER_BY_DAY[day];
    if (!rotationHelper) return [];
    if (rotationHelper === 'snowman') {
      const helperId = plan && plan.day3Helper ? plan.day3Helper : resolveHelperId('snowman');
      return [{ helperId, amount: ROTATION_AMOUNT }];
    }
    return [{ helperId: resolveHelperId(rotationHelper), amount: ROTATION_AMOUNT }];
  }

  function isSpecialDay(day) {
    return day === DAY4 || day === DAY7;
  }

  // Bumps the persisted "last seen" date forward (monotonic max) so a
  // later backwards jump can be detected even on a day when nothing was
  // claimed - e.g. opening the game yesterday without claiming, then having
  // the clock jump back to two days ago, must still be caught. Only ever
  // moves forward or leaves things alone; never rewrites lastSeenDate to an
  // earlier value, which is exactly what the tampering guard in
  // computeClaim below is watching for.
  function syncSeenDate() {
    const record = Platform.loadDailyGift();
    const todayKey = getTodayKey();
    if (record.lastSeenDate && daysBetweenKeys(record.lastSeenDate, todayKey) <= 0) return record;
    const updated = Object.assign({}, record, { lastSeenDate: todayKey });
    Platform.saveDailyGift(updated);
    return updated;
  }

  // Pure decision: given the persisted record and today's calendar-date
  // key, decides whether a claim is available and what it would grant,
  // without touching storage or charges - claim() below is the only thing
  // that actually persists/credits it. Also doubles as the popup's preview
  // (computeClaim(record, todayKey) with no further action taken).
  //
  // "available: false" covers two distinct cases the UI treats the same
  // way (nothing to claim right now):
  //  - today's reward was already claimed (tampered: false);
  //  - the device clock appears to have moved BACKWARDS relative to the
  //    latest date this module has ever observed (tampered: true) - a
  //    sanity guard, not real fraud prevention: it can't stop someone
  //    walking the clock forward a day at a time, only catch an actual
  //    backwards jump. A real fix needs server time (Garden.platform.now
  //    is the one clock entry point everything here goes through, so
  //    swapping it for a Yandex SDK server-time call later needs no
  //    changes here).
  function computeClaim(record, todayKey) {
    record = record || Platform.loadDailyGift();

    const alreadyClaimedToday = record.lastClaimDate === todayKey;
    const tampered = !!record.lastSeenDate && daysBetweenKeys(record.lastSeenDate, todayKey) < 0;

    if (alreadyClaimedToday || tampered) {
      return { available: false, tampered: tampered && !alreadyClaimedToday, record, reward: null };
    }

    const position = nextPositionAfter(record.position);
    // Freeze a fresh plan exactly when a new cycle starts (never claimed
    // before, or wrapping from day 7 to day 1); otherwise reuse the plan
    // already frozen for this cycle - see computePlan's own comment.
    const plan = isNewCycleStart(record.position) ? computePlan() : record.plan;
    return {
      available: true,
      tampered: false,
      record: { lastClaimDate: todayKey, lastSeenDate: todayKey, position, plan },
      reward: { day: position, credits: rewardForDay(position, plan) },
    };
  }

  // Read-only preview of today's status (used by both the badge and the
  // popup) - syncs lastSeenDate as a side effect (see syncSeenDate), then
  // decides without granting anything.
  function previewToday() {
    const record = syncSeenDate();
    return computeClaim(record, getTodayKey());
  }

  // The only place that actually persists a claim and credits charges.
  // Writes the new record FIRST, then credits charges - so a reload or
  // crash between the two can never double-claim: a later call always sees
  // lastClaimDate already equal to today and reports available: false,
  // even if the charge credit itself never happened. A rapid double tap is
  // likewise safe: the second call re-reads the just-written record and
  // finds alreadyClaimedToday already true.
  function claim() {
    const record = syncSeenDate();
    const todayKey = getTodayKey();
    const result = computeClaim(record, todayKey);
    if (result.available) {
      Platform.saveDailyGift(result.record);
      const Helpers = root.Garden.helpers;
      result.reward.credits.forEach(function (credit) {
        Helpers.addCharges(credit.helperId, credit.amount);
      });
    }
    return result;
  }

  // --- Debug day-simulation (only ever wired to window.GardenDebug by
  // main.js, and only when Garden.platform.isDebugEnabled() is true - see
  // its own comment). Lets the full day-by-day cycle be exercised without
  // waiting on real calendar days. ---

  // Shifts the simulated clock by `days` (positive or negative), on top of
  // whatever offset is already in effect - repeated calls accumulate, e.g.
  // advanceDays(1) three times behaves like advanceDays(3) once. Never
  // touches the daily-gift record itself, only Garden.platform.now()'s
  // debug offset - exactly simulates "N real days passed."
  function debugAdvanceDays(days) {
    Platform.saveDebugDayOffset(Platform.loadDebugDayOffset() + days);
  }

  // Resets the daily-gift record to "never claimed" - the offset day
  // (debugAdvanceDays) is left as-is, so this only rewinds progress, not
  // the simulated date.
  function debugResetDailyGift() {
    Platform.saveDailyGift({ lastClaimDate: null, lastSeenDate: null, position: 0, plan: null });
  }

  // Jumps straight to day k (1-7) being the next claimable day, without
  // stepping through every day in between: sets lastClaimDate to
  // yesterday (so today's claim is available) and position to k-1 (so the
  // next claim resolves to day k). k=1 instead sets lastClaimDate to null
  // (equivalent to a fresh cycle, no plan). For k > 1, computes and
  // freezes a plan right now (exactly as a real day-1 claim would have),
  // so day 4/7's frozen preview is testable without claiming through every
  // earlier day first.
  function debugJumpToDay(k) {
    const todayKey = getTodayKey();
    if (k <= 1) {
      Platform.saveDailyGift({ lastClaimDate: null, lastSeenDate: todayKey, position: 0, plan: null });
      return;
    }
    const yesterdayKey = advanceDateKey(todayKey, -1);
    Platform.saveDailyGift({ lastClaimDate: yesterdayKey, lastSeenDate: todayKey, position: k - 1, plan: computePlan() });
  }

  // Browser-only: wires the menu's daily-gift button (with its unclaimed-
  // today badge) and the 7-day popup. No game-rule logic beyond calling
  // claim()/previewToday(). Hook classes/attributes for Codex's later
  // styling pass (see GAME_DESIGN.md): .daily-gift-btn, .daily-gift-badge,
  // .daily-popup, .daily-day[data-state="claimed|today|upcoming|paused"]
  // plus data-day="1".."7" and data-special="true" on days 4 and 7.
  function createDailyGiftScreen(dom, handlers) {
    handlers = handlers || {};
    const I18n = root.Garden.i18n;
    const helperIconFor = root.Garden.render.helperIconFor;
    const triggerOneShotAnim = root.Garden.render.triggerOneShotAnim;

    dom.dailyCheckinButton.classList.add('daily-gift-btn');
    dom.checkinBadge.classList.add('daily-gift-badge');
    dom.checkinOverlay.classList.add('daily-popup');

    function dayCellLabel(day, state, credits) {
      const rewardText = credits
        .map(function (c) {
          return I18n.t(HELPER_NAME_KEY[c.helperId]) + ' +' + c.amount;
        })
        .join(', ');
      const stateKey = {
        claimed: 'dailyGiftDayStateClaimed',
        today: 'dailyGiftDayStateToday',
        paused: 'dailyGiftDayStatePaused',
        upcoming: 'dailyGiftDayStateUpcoming',
      }[state];
      return I18n.t('dailyGiftDayLabel', { day }) + ': ' + I18n.t(stateKey) + (rewardText ? ', ' + rewardText : '');
    }

    // Day-cell states: claimed (d <= the last-claimed position), today
    // (the next claimable day, right now), paused (the day right after
    // today's just-claimed one - waiting for tomorrow, not reset), or
    // upcoming (anything further out). See computeClaim's own comment for
    // why "already claimed" and "clock tampered" are both treated as
    // blocked the same way.
    function buildDayStates(record, blocked) {
      const states = new Array(CYCLE_LENGTH + 1).fill('upcoming');
      if (blocked && record.lastClaimDate === getTodayKey()) {
        const paused = nextPositionAfter(record.position);
        for (let d = 1; d <= CYCLE_LENGTH; d++) {
          if (d <= record.position) states[d] = 'claimed';
          else if (d === paused) states[d] = 'paused';
        }
      } else {
        const next = nextPositionAfter(record.position);
        for (let d = 1; d <= CYCLE_LENGTH; d++) {
          if (d < next) states[d] = 'claimed';
          else if (d === next) states[d] = 'today';
        }
      }
      return states;
    }

    // One icon+amount pair per credit (rather than grouping every icon
    // together under one shared amount) - the only way to show "each icon
    // with +N" consistently, since a day's credits can land on the same
    // helper twice (e.g. day 7 with Snowman still locked) yet must still
    // read as separate, equal-amount slots rather than one bigger number.
    function creditPairsHtml(credits) {
      return credits
        .map(function (c) {
          return (
            '<span class="daily-day-reward-item"><span class="helper-reward-icons">' +
            helperIconFor(c.helperId) +
            '</span><span>+' +
            c.amount +
            '</span></span>'
          );
        })
        .join('');
    }

    function buildPopup() {
      // The REAL current record (not computeClaim's hypothetical "if
      // claimed now" record, which only matters to claim() itself) - day
      // states are always rendered from this, whether or not a claim is
      // currently available.
      const record = syncSeenDate();
      const blocked = !computeClaim(record, getTodayKey()).available;
      const states = buildDayStates(record, blocked);
      // The frozen plan only applies to a cycle already in progress; once
      // the last claimed day is 7 (or nothing has ever been claimed), the
      // next claim would start a NEW cycle whose plan isn't decided yet -
      // preview those with a live "best guess right now" instead of the
      // just-finished cycle's stale plan.
      const displayPlan = isNewCycleStart(record.position) ? null : record.plan;

      dom.checkinDaysRow.innerHTML = '';
      for (let day = 1; day <= CYCLE_LENGTH; day++) {
        const state = states[day];
        const credits = rewardForDay(day, displayPlan);

        const el = document.createElement('div');
        el.className = 'daily-day';
        el.dataset.state = state;
        el.dataset.day = String(day);
        if (isSpecialDay(day)) el.dataset.special = 'true';
        el.setAttribute('aria-label', dayCellLabel(day, state, credits));

        const markEl = document.createElement('div');
        markEl.className = 'daily-day-mark';
        markEl.textContent = String(day);
        el.appendChild(markEl);

        const rewardEl = document.createElement('div');
        rewardEl.className = 'daily-day-reward';
        rewardEl.innerHTML = creditPairsHtml(credits);
        el.appendChild(rewardEl);

        dom.checkinDaysRow.appendChild(el);
      }

      // Repurposed from the old streak lines: the first now shows "day N of
      // 7", the second shows the "come back tomorrow" state line only when
      // blocked (hidden otherwise) - see GAME_DESIGN.md for why these two
      // existing elements were reused rather than left unused.
      dom.checkinCurrentStreakText.textContent = I18n.t('dailyGiftDayLabel', { day: nextPositionAfter(record.position) });
      dom.checkinBestStreakText.textContent = I18n.t('dailyGiftComeBackTomorrow');
      dom.checkinBestStreakText.hidden = !blocked;

      dom.checkinClaimButton.disabled = blocked;
      dom.checkinClaimButton.textContent = I18n.t(blocked ? 'checkinClaimedButton' : 'checkinClaimButton');
      dom.checkinClaimReward.hidden = true;
    }

    function updateBadge() {
      dom.checkinBadge.hidden = !previewToday().available;
    }

    function render() {
      // Static (param-free) labels - re-set on every render() call rather
      // than once at construction, so a language switch (js/main.js, which
      // calls checkinScreen.render() immediately after I18n.setLang())
      // picks these up right away without needing a reload.
      dom.dailyCheckinLabel.textContent = I18n.t('dailyCheckinButtonLabel');
      dom.checkinTitle.textContent = I18n.t('dailyCheckinButtonLabel');
      dom.checkinCloseButton.setAttribute('aria-label', I18n.t('closeButtonLabel'));

      updateBadge();
      if (!dom.checkinOverlay.hidden) buildPopup();
    }

    function openPopup() {
      buildPopup();
      dom.checkinOverlay.hidden = false;
    }

    function closePopup() {
      dom.checkinOverlay.hidden = true;
    }

    dom.dailyCheckinButton.addEventListener('click', function () {
      AudioFx.playEffect('tap');
      openPopup();
    });
    dom.checkinCloseButton.addEventListener('click', function () {
      AudioFx.playEffect('tap');
      closePopup();
    });
    dom.checkinOverlay.addEventListener('click', function (event) {
      if (event.target === dom.checkinOverlay) closePopup();
    });

    dom.checkinClaimButton.addEventListener('click', function () {
      const result = claim();
      buildPopup();
      updateBadge();
      if (result.reward) {
        AudioFx.playEffect('reward');
        // All of the per-credit icon+amount pairs go inside the icons slot
        // (see creditPairsHtml) - the separate amount slot next to it is
        // left empty/hidden, since each credit now carries its own amount
        // rather than sharing one combined number.
        dom.checkinClaimRewardIcons.innerHTML = creditPairsHtml(result.reward.credits);
        dom.checkinClaimRewardAmount.textContent = '';
        dom.checkinClaimRewardAmount.hidden = true;
        dom.checkinClaimReward.hidden = false;
        triggerOneShotAnim(dom.checkinClaimReward, 'reward-pop');
      }
      if (typeof handlers.onClaimed === 'function') handlers.onClaimed(result);
    });

    return { render };
  }

  const Checkin = {
    CYCLE_LENGTH,
    ROTATION_HELPER_BY_DAY,
    ROTATION_AMOUNT,
    DAY4,
    DAY4_AMOUNT,
    DAY7,
    DAY7_AMOUNT,
    dateKeyFromParts,
    dateKeyFromDate,
    daysBetweenKeys,
    advanceDateKey,
    getTodayKey,
    nextPositionAfter,
    fewestChargesAmong,
    resolveHelperId,
    day4EligibleHelpers,
    computePlan,
    isNewCycleStart,
    rewardForDay,
    isSpecialDay,
    previewToday,
    computeClaim,
    claim,
    debugAdvanceDays,
    debugResetDailyGift,
    debugJumpToDay,
    createDailyGiftScreen,
  };

  root.Garden = root.Garden || {};
  root.Garden.checkin = Checkin;
})(typeof window !== 'undefined' ? window : globalThis);
