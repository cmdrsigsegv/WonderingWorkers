// The quick reactions a player can send. Each one is stored with the round
// at rounds/rN/<key>/<uid> = server time, so a player can send each kind
// once per round, and they all go away with the board.
//
// To add another reaction, add an entry here, a sound in sound.js, and the
// key to database.rules.json.

export const REACTIONS = [
  { key: 'nice', emoji: '\u{1F44D}', button: 'Nice', phrase: '', title: 'Send a thumbs up to everyone' },
  {
    key: 'stupid',
    emoji: '\u{1F926}',
    button: 'I am stupid',
    phrase: 'I am stupid',
    title: 'Admit to everyone that you messed up',
  },
  { key: 'angry', emoji: '\u{1F621}', button: '', phrase: '', title: 'Show everyone you are angry' },
];
