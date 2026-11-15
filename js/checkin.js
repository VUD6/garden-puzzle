// Daily check-in: pure streak/date logic (Node-testable, no DOM) plus a
// small self-contained DOM controller for the menu button and its popup.
// Rewards are always credited through the helpers module (Garden.helpers) -
// this file never writes charge storage directly.
(function (root) {
  const Platform = root.Garden.platform;

  const CYCLE_LENGTH = 7;
  // Reward by position in the 7-day cycle; any day not listed (1, 2, 3, 5,
  // 6) grants none - the day is just marked claimed and keeps the streak
  // going. Kept as the one place these values live. allHelpers:false means
  // one helper, chosen deterministically from the day's own calendar date
  // (see pickDailyHelperId) - never from its position in the cycle.
  const HELPER_REWARD_BY_DAY = {
    4: { amount: 3, allHelpers: false },
    7: { amount: 2, allHelpers: true },
  };

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
  // diffing two of them. Used to preview a future row in the check-in popup
  // (e.g. "what date would day 4 of this cycle land on, assuming the streak
  // continues uninterrupted") without ever touching time-of-day/DST.
  function advanceDateKey(dateKey, days) {
    const [y, m, d] = dateKey.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
    return dateKeyFromParts(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
  }

  // Position in the 7-day row for a given (1-based) streak length: after
  // day 7, the next consecutive day wraps to position 1 of a new cycle
  // while the streak itself keeps counting (so bestStreak can exceed 7).
  function dayInCycle(streak) {
    return ((streak - 1) % CYCLE_LENGTH) + 1;
  }

  // Deterministic pick of which single helper a day-4 reward credits,
  // keyed only by that day's actual calendar date (never by which position
  // in the cycle it happens to be) - so the same date always picks the same
  // helper, and the check-in popup can preview it for a not-yet-claimed row.
  function pickDailyHelperId(dateKey) {
    const [y, m, d] = dateKey.split('-').map(Number);
    const seed = Date.UTC(y, m - 1, d) >>> 0;
    const ids = root.Garden.helpers.HELPER_IDS;
    const roll = root.Garden.rng.createRng(seed)();
    return ids[Math.floor(roll * ids.length)];
  }

  // The reward a given cycle position would grant if claimed on dateKey, or
  // null for a day that grants nothing. Shared by claim() (acting on the
  // real today) and the popup preview (acting on a hypothetical future row).
  function helperRewardForDayAt(day, dateKey) {
    const config = HELPER_REWARD_BY_DAY[day];
    if (!config) return null;
    if (config.allHelpers) return { amount: config.amount, allHelpers: true, helperId: null };
    return { amount: config.amount, allHelpers: false, helperId: pickDailyHelperId(dateKey) };
  }

  // Pure decision: given the persisted record and today's calendar-date
  // key, decides the new record and reward without touching storage or
  // charges. claim() below is the only thing that actually persists it.
  //
  // alreadyClaimedToday covers two distinct cases that the UI treats the
  // same way (nothing to claim right now, show as already claimed):
  //  - today's reward was already claimed;
  //  - the device clock moved BACKWARDS past the last claim date. This is
  //    only a sanity guard against an accidental/naive clock change - a
  //    purely client-side check can't stop someone from moving the clock
  //    forward one day at a time to farm streaks, so it only catches the
  //    backwards case. A real fix needs server time, which is a Step 8
  //    follow-up once the Yandex SDK is wired in.
  function computeClaim(record, todayKey) {
    record = record || { lastClaimDate: null, currentStreak: 0, bestStreak: 0 };

    if (record.lastClaimDate === todayKey) {
      return { claimed: false, alreadyClaimedToday: true, record, reward: null };
    }

    if (record.lastClaimDate && daysBetweenKeys(record.lastClaimDate, todayKey) < 0) {
      return { claimed: false, alreadyClaimedToday: true, record, reward: null };
    }

    const isConsecutive = record.lastClaimDate && daysBetweenKeys(record.lastClaimDate, todayKey) === 1;
    const nextStreak = isConsecutive ? record.currentStreak + 1 : 1;
    const nextBest = Math.max(record.bestStreak || 0, nextStreak);
    const reward = helperRewardForDayAt(dayInCycle(nextStreak), todayKey);

    return {
      claimed: true,
      alreadyClaimedToday: false,
      record: { lastClaimDate: todayKey, currentStreak: nextStreak, bestStreak: nextBest },
      reward,
    };
  }

  // The only place that actually persists a claim. Writes the new streak
  // record FIRST, then credits charges - so a reload or crash between the
  // two can never double-claim: a later call always sees lastClaimDate
  // already equal to today and reports alreadyClaimedToday, even if the
  // charge credit itself never happened.
  function claim() {
    const record = Platform.loadCheckin();
    const todayKey = dateKeyFromDate(Platform.now());
    const result = computeClaim(record, todayKey);
    if (result.claimed) {
      Platform.saveCheckin(result.record);
      if (result.reward) {
        const Helpers = root.Garden.helpers;
        if (result.reward.allHelpers) {
          Helpers.HELPER_IDS.forEach(function (id) { Helpers.addCharges(id, result.reward.amount); });
        } else {
          Helpers.addCharges(result.reward.helperId, result.reward.amount);
        }
      }
    }
    return result;
  }

  // Browser-only: wires the menu's check-in button (with its unclaimed-dot
  // badge) and the 7-day popup. No game-rule logic beyond calling claim().
  function createCheckinScreen(dom, handlers) {
    handlers = handlers || {};
    const I18n = root.Garden.i18n;
    const Helpers = root.Garden.helpers;
    const pieceSvgFor = root.Garden.render.pieceSvgFor;
    const helperIconFor = root.Garden.render.helperIconFor;
    const triggerOneShotAnim = root.Garden.render.triggerOneShotAnim;

    dom.dailyCheckinLabel.textContent = I18n.t('dailyCheckinButtonLabel');
    dom.checkinTitle.textContent = I18n.t('dailyCheckinButtonLabel');
    dom.checkinCloseButton.setAttribute('aria-label', I18n.t('closeButtonLabel'));

    function buildPopup() {
      const record = Platform.loadCheckin();
      const todayKey = dateKeyFromDate(Platform.now());
      // Reuses computeClaim as a pure *preview* (it has no side effects) to
      // find where "today" sits in the row and whether claiming is
      // currently blocked - the exact same rule used by claim() itself,
      // including the backwards-clock guard.
      const preview = computeClaim(record, todayKey);
      const todayPosition = dayInCycle(preview.record.currentStreak);
      const blocked = preview.alreadyClaimedToday;

      dom.checkinDaysRow.innerHTML = '';
      for (let day = 1; day <= CYCLE_LENGTH; day++) {
        const isClaimed = day < todayPosition || (day === todayPosition && blocked);
        const isToday = day === todayPosition;
        const isFuture = day > todayPosition;

        const el = document.createElement('div');
        el.className =
          'checkin-day' + (isClaimed ? ' is-claimed' : '') + (isToday ? ' is-today' : '') + (isFuture ? ' is-future' : '');

        const markEl = document.createElement('div');
        markEl.className = 'checkin-day-mark';
        if (isClaimed) {
          markEl.innerHTML = pieceSvgFor(day - 1);
        } else {
          markEl.textContent = String(day);
        }
        el.appendChild(markEl);

        // The calendar date this row would actually be claimed on, assuming
        // the streak continues uninterrupted from today - lets a day-4
        // row's single-helper pick be previewed accurately even before it's
        // reached, since the pick only ever depends on the date.
        const rowDateKey = advanceDateKey(todayKey, day - todayPosition);
        const reward = helperRewardForDayAt(day, rowDateKey);
        if (reward) {
          const rewardEl = document.createElement('div');
          rewardEl.className = 'checkin-day-reward';
          const ids = reward.allHelpers ? Helpers.HELPER_IDS : [reward.helperId];
          rewardEl.innerHTML =
            '<span class="helper-reward-icons">' + ids.map(helperIconFor).join('') + '</span><span>+' + reward.amount + '</span>';
          el.appendChild(rewardEl);
        }

        dom.checkinDaysRow.appendChild(el);
      }

      dom.checkinCurrentStreakText.textContent = I18n.t('checkinCurrentStreak', { count: record.currentStreak });
      dom.checkinBestStreakText.textContent = I18n.t('checkinBestStreak', { count: record.bestStreak });

      dom.checkinClaimButton.disabled = blocked;
      dom.checkinClaimButton.textContent = I18n.t(blocked ? 'checkinClaimedButton' : 'checkinClaimButton');
      dom.checkinClaimReward.hidden = true;
    }

    function updateBadge() {
      const record = Platform.loadCheckin();
      const todayKey = dateKeyFromDate(Platform.now());
      dom.checkinBadge.hidden = record.lastClaimDate === todayKey;
    }

    function openPopup() {
      buildPopup();
      dom.checkinOverlay.hidden = false;
    }

    function closePopup() {
      dom.checkinOverlay.hidden = true;
    }

    dom.dailyCheckinButton.addEventListener('click', openPopup);
    dom.checkinCloseButton.addEventListener('click', closePopup);
    dom.checkinOverlay.addEventListener('click', function (event) {
      if (event.target === dom.checkinOverlay) closePopup();
    });

    dom.checkinClaimButton.addEventListener('click', function () {
      const result = claim();
      buildPopup();
      updateBadge();
      if (result.reward) {
        const ids = result.reward.allHelpers ? Helpers.HELPER_IDS : [result.reward.helperId];
        dom.checkinClaimRewardIcons.innerHTML = ids.map(helperIconFor).join('');
        dom.checkinClaimRewardAmount.textContent = '+' + result.reward.amount;
        dom.checkinClaimReward.hidden = false;
        triggerOneShotAnim(dom.checkinClaimReward, 'reward-pop');
      }
      if (typeof handlers.onClaimed === 'function') handlers.onClaimed(result);
    });

    return { render: updateBadge };
  }

  const Checkin = {
    CYCLE_LENGTH,
    HELPER_REWARD_BY_DAY,
    dateKeyFromParts,
    dateKeyFromDate,
    daysBetweenKeys,
    advanceDateKey,
    dayInCycle,
    pickDailyHelperId,
    helperRewardForDayAt,
    computeClaim,
    claim,
    createCheckinScreen,
  };

  root.Garden = root.Garden || {};
  root.Garden.checkin = Checkin;
})(typeof window !== 'undefined' ? window : globalThis);
