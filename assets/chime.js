/* The "you got it" sound.

   The lung-sound trainer grades the moment you answer, so it gets the chime
   per answer. The practice exam deliberately withholds right/wrong until you
   submit, the way the real NREMT does, so a sound on selection there would hand
   you the answer — it gets the end-of-session flourish instead, when the score
   is revealed.

   Why synthesized rather than an audio file: a chime is ~12 lines of
   oscillator, and the alternative is shipping binary assets that the service
   worker then has to precache for offline use. Nothing to download, nothing to
   cache, no format fallbacks.

   Two details that make it feel like a reward instead of a beep:

     - The pitch climbs with the run. Six correct answers in a row walk up a
       pentatonic ladder, and a miss drops you back to the bottom. That is the
       whole reason `answer(false)` exists and has to be called on wrong
       answers too — without it the ladder would ratchet up and never come
       down, and the fifth right answer would sound exactly like the fiftieth.
     - Every note is two detuned oscillators through a lowpass, not one raw
       sine. A bare sine reads as a UI error tone; the beating between two
       near-identical voices is what makes it read as a bell.

   Off switch: the speaker button in the header (drawn by assets/nav.js),
   remembered in localStorage. */
(function(){
  var PREF_KEY = 'levl_sound';

  // Pentatonic ladder, in semitones above the base note. A run of correct
  // answers walks up it and stops at the top rather than climbing into
  // dog-whistle territory.
  var LADDER = [0, 2, 4, 7, 9, 12];
  var BASE_HZ = 523.25;             // C5
  var TRIAD = [0, 4, 9];            // root, major third, major sixth — bright
                                    // and unresolved, so it lifts at the end
  var MASTER = 0.16;

  var enabled = true;
  try {
    enabled = localStorage.getItem(PREF_KEY) !== 'off';
  } catch(e){}

  var streak = 0;
  var ctx = null;
  var listeners = [];

  function semis(n){ return Math.pow(2, n / 12); }

  /* The AudioContext is built on the first sound, never at load: browsers
     create it suspended until a user gesture, and every call into here happens
     inside a click handler, so by then it can actually start. resume() covers
     the tab that was backgrounded and had its context suspended out from under
     it. */
  function audio(){
    if(!ctx){
      var AC = window.AudioContext || window.webkitAudioContext;
      if(!AC) return null;
      try { ctx = new AC(); } catch(e){ return null; }
    }
    if(ctx.state === 'suspended') ctx.resume().catch(function(){});
    return ctx;
  }

  /* One bell note: two oscillators a few cents apart, a fast attack so it
     sounds struck rather than faded in, and an exponential tail. The lowpass
     takes the glassy edge off the top harmonics — without it the higher rungs
     of the ladder get shrill. */
  function note(c, hz, at, dur, gain){
    var out = c.createGain();
    out.gain.setValueAtTime(0.0001, at);
    out.gain.exponentialRampToValueAtTime(gain, at + 0.008);
    out.gain.exponentialRampToValueAtTime(0.0001, at + dur);

    var lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 6000;
    lp.connect(out);
    out.connect(c.destination);

    [[ 'sine', hz, 1 ], [ 'triangle', hz * 1.004, 0.35 ]].forEach(function(v){
      var o = c.createOscillator();
      o.type = v[0];
      o.frequency.value = v[1];
      var g = c.createGain();
      g.gain.value = v[2];
      o.connect(g); g.connect(lp);
      o.start(at);
      o.stop(at + dur + 0.02);
    });
  }

  /* The reward itself: a three-note arpeggio up a major-sixth chord, plus a
     quiet note an octave over the last one so the tail sparkles. ~0.35s total
     — short enough to fire on every answer without becoming the thing you
     notice. */
  function correct(){
    if(!enabled) return;
    var c = audio();
    if(!c) return;
    var root = BASE_HZ * semis(LADDER[Math.min(streak, LADDER.length - 1)]);
    var t = c.currentTime + 0.01;
    streak++;
    TRIAD.forEach(function(iv, i){
      note(c, root * semis(iv), t + i * 0.07, 0.3, MASTER);
    });
    note(c, root * semis(TRIAD[TRIAD.length - 1] + 12), t + 0.14, 0.42, MASTER * 0.4);
  }

  /* The single entry point the answer paths call. Passing the verdict in —
     rather than having callers decide whether to make a sound — is what keeps
     the run counter honest: a wrong answer is silent, but it still has to be
     reported so the ladder resets. */
  function answer(isCorrect){
    if(isCorrect) correct();
    else streak = 0;
  }

  function resetStreak(){ streak = 0; }

  /* End of a session, when the score appears. A five-note run resolving on the
     octave for a good result, a shorter and lower three-note settle for a
     rough one — encouraging either way, since a losing-game jingle after a bad
     practice run is the last thing anyone needs. `ratio` is 0..1. */
  function flourish(ratio){
    if(!enabled) return;
    var c = audio();
    if(!c) return;
    streak = 0;
    var good = (typeof ratio !== 'number') || ratio >= 0.7;
    var run = good ? [0, 4, 7, 12, 16] : [0, 3, 7];
    var root = BASE_HZ * (good ? 1 : 0.75);
    var t = c.currentTime + 0.01;
    run.forEach(function(iv, i){
      note(c, root * semis(iv), t + i * 0.09, i === run.length - 1 ? 0.8 : 0.34,
           MASTER * (good ? 1 : 0.8));
    });
    // A soft note a fifth under the run, held through it, so the arpeggio lands
    // on something rather than in silence.
    if(good) note(c, root * semis(-5), t, 0.95, MASTER * 0.3);
  }

  function isEnabled(){ return enabled; }

  function setEnabled(on){
    enabled = !!on;
    try { localStorage.setItem(PREF_KEY, enabled ? 'on' : 'off'); }catch(e){}
    listeners.forEach(function(fn){ try { fn(enabled); }catch(e){} });
    // Confirm the choice in the medium being chosen — turning sound back on
    // with no sound is a dead-feeling button.
    if(enabled) correct();
  }

  function toggle(){ setEnabled(!enabled); }

  // nav.js subscribes so its speaker button keeps the right icon even
  // when another tab or another part of the page flips the preference.
  function onChange(fn){ if(typeof fn === 'function') listeners.push(fn); }

  window.LevlSound = {
    correct: correct,
    answer: answer,
    resetStreak: resetStreak,
    flourish: flourish,
    isEnabled: isEnabled,
    setEnabled: setEnabled,
    toggle: toggle,
    onChange: onChange,
    PREF_KEY: PREF_KEY,
  };
})();
