/** Pick one random element from an array. */
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Creative time-and-context-aware greeting, refreshed once per page load.
 * Pools are intentionally large so the dashboard feels alive across visits.
 */
export function greeting() {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay(); // 0 = Sun, 6 = Sat

  // ── Time-of-day pools ──────────────────────────────────────────────
  const earlyMorning = [
    `You're up early — the best ideas happen before the world wakes up`,
    'Dawn patrol. Coffee first, meetings later',
    'The early bird gets the action items',
    `Up before the sun? That's dedication`,
    'Early start today — your future self will thank you',
  ];

  const morning = [
    'Good morning — ready to make today count?',
    'Morning! Fresh day, fresh notes',
    'Top of the morning to you',
    `Good morning — what's on the agenda today?`,
    'Rise and shine — your meetings await',
    `Good morning! Let's capture some great ideas today`,
    `Morning — the calendar's filling up, let's stay sharp`,
    'Hello! A new day of productive meetings ahead',
  ];

  const afternoon = [
    'Good afternoon — keeping the momentum going',
    `Afternoon check-in. How's the day shaping up?`,
    `Good afternoon — you've got this`,
    'Halfway through the day and still going strong',
    'Good afternoon! Time to power through the rest',
    'Post-lunch productivity mode: activated',
    `Good afternoon — let's make the second half count`,
    'Afternoon! Hope your meetings are going smoothly',
  ];

  const evening = [
    'Good evening — winding down or ramping up?',
    'Evening! Almost time to close the notebook',
    'Good evening — wrapping up a productive day?',
    `The day's meetings are behind you. Time to reflect`,
    `Good evening — tomorrow's a fresh start`,
    'Evening mode. Review your notes, plan tomorrow',
    'Good evening! Great work getting through today',
    'Settling in for the evening? Your notes are waiting',
  ];

  const lateNight = [
    'Burning the midnight oil?',
    `Late night session — don't forget to rest`,
    `Still at it? That's commitment`,
    'The quiet hours — perfect for reviewing notes',
    'Night owl mode. The best ideas sneak in late',
    'Working late? Your notes will be here in the morning',
  ];

  // ── Day-of-week bonus greetings ────────────────────────────────────
  const mondayBonus = [
    `Happy Monday — let's set the tone for the week`,
    'Monday: new week, new meetings, new possibilities',
    `Welcome back! Monday's full of fresh starts`,
  ];

  const fridayBonus = [
    'Happy Friday — the finish line is in sight',
    'Friday! One last push before the weekend',
    `TGIF — let's wrap this week up strong`,
  ];

  const weekendBonus = [
    'Working on the weekend? Respect',
    `Weekend warrior mode — hope it's optional!`,
    'Weekend hours — the office is all yours',
  ];

  // ── Build the candidate pool ───────────────────────────────────────
  let pool;
  if (hour < 6) pool = [...lateNight];
  else if (hour < 9) pool = [...earlyMorning, ...morning];
  else if (hour < 12) pool = [...morning];
  else if (hour < 18) pool = [...afternoon];
  else if (hour < 22) pool = [...evening];
  else pool = [...lateNight];

  // Mix in day-of-week specials (adds variety, not guaranteed to show).
  if (day === 1) pool.push(...mondayBonus);
  if (day === 5) pool.push(...fridayBonus);
  if (day === 0 || day === 6) pool.push(...weekendBonus);

  return pick(pool);
}
