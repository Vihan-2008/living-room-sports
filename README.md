# Living Room Sports

A Wii-inspired living room dashboard, four phone remotes, five original sports games, and a simultaneous kart-racing channel. Plain HTML, CSS and JavaScript; a dependency-free Node HTTP/WebSocket server. Everything is served locally, with no accounts or external assets.

## Run on this PC

Install Node.js 22 or newer if needed. In this project folder run:

```powershell
npm start
```

Open **http://localhost:3000** on the PC. Keep one dashboard tab open. Stop the server with Ctrl+C. The server listens on all local interfaces, port 3000; use it on a trusted home network. This app has no internet hosting or deployment step.

## Join with phones

1. Put the PC and phones on the same Wi-Fi. Avoid guest networks with client isolation.
2. Click **Pair a phone** on the dashboard. Open one of the displayed `http://192.168.…:3000/remote?code=…` links on each phone. A VPN or virtual adapter may produce extra links; choose the PC's Wi-Fi address. A link is provided instead of a QR code.
3. Enter your name and tap **Join the game**. The room code is filled from the link. Each phone gets a player number, colour, and indicator light. Up to four phones can join; leaving frees the slot. Keep the phone browser in the foreground. Reconnection is automatic, but a reconnecting phone may receive another free slot.
4. If your OS asks, allow Node on **private networks**. If a phone cannot connect, check the local firewall and Wi-Fi client isolation. Do not expose the port on your router.
5. On the PC choose a channel, or use the remote D-pad and A. Players connected when the match starts join that match; new arrivals join the next one. Sports alternate players at frame, game, round, hole or inning boundaries. Kart racers play simultaneously. An offline player's turn or kart can be controlled from the PC keyboard; **New match** rebuilds the roster. Without phones, the keyboard controls a solo player.

## Motion sensors and HTTPS

**LAN HTTP works for pairing and all buttons. Most mobile browsers block motion sensors on HTTP.** This is a browser restriction, and cannot be bypassed by JavaScript. Tap **Enable motion** on the remote to request both DeviceMotion and DeviceOrientation permissions, including the iOS permission dialogs. Hold the phone upright, then tap **Recenter**. The remote reports whether actual sensor data arrives. Permission denial, missing sensors and insecure pages fall back to buttons.

For phone motion, the owner must supply a **trusted HTTPS local endpoint** that proxies this app's HTTP and `/ws` WebSocket traffic to port 3000. Open the dashboard and remotes through that same HTTPS endpoint (phone path `/remote?code=ROOMCODE`; copy the room code displayed on the dashboard). The automatic links show direct HTTP addresses; replace their scheme/host with the HTTPS endpoint. Its certificate must be trusted by each phone, and its proxy must preserve the public Host/Origin relationship for WebSocket upgrade requests. Self-signed certificate warnings alone may not enable sensors. This project does not generate, read, or manage certificates or keys, configure a proxy, or deploy services. On Android Chrome, a development alternative is the browser's “Insecure origins treated as secure” setting for the exact local HTTP origin; this changes browser security and should be reverted after local testing. iOS generally needs trusted HTTPS.

Device capabilities vary. The browser exposes orientation and acceleration, not a real infrared pointer or a calibrated console controller. Pointing uses relative yaw, swings use acceleration thresholds, and a strong shake recentres. Vibration feedback is best-effort using `navigator.vibrate`; iOS browsers commonly do not support it. Keep a comfortable grip and room to move; gentle gestures suffice.

## Remote and games

The elongated white remote has a round D-pad housing, A, minus, Home, plus, 1 and 2 buttons, four player lights, and a labelled underside B-trigger panel (accessible on the front of the phone screen).

Buttons support simultaneous touches: hold a direction and B together, or keep a button held with either of two fingers. Interrupted touches, lost pointer capture, switching away and leaving the room cancel held controls without firing a shot, clear pending swing data and centre aim. Motion input pauses while the page is hidden or unfocused and resumes with a fresh pointing centre when you return. Reconnecting starts with no buttons held. Losing focus on the PC dashboard cancels charging and blocking too. Press B again to resume charging or blocking; an intentional B release still shoots. Kart cancellation clears steering, braking and drift without awarding a drift boost.

- **D-pad left/right:** choose a channel or adjust aim. **A / 2:** launch or play. **Home:** return to menu. **− / +:** previous/next channel; + starts a new match after the result.
- **Point:** aim with orientation. **Hold B:** charge a shot; release to shoot in bowling/golf. In boxing B blocks and widens the timing window. **Shake / 1:** recenter. A uses the visible power meter, so motion is optional.
- **Bluebird Lanes (bowling):** ten frames, two rolls per frame unless you strike. The second roll clears remaining pins. Strikes count the next two rolls; spares count the next roll. The tenth frame awards earned bonus rolls. Maximum 300. Scores include bonuses as subsequent rolls arrive.
- **Sunbeam Rally (tennis):** time returns in the blue window and aim toward the moving opponent. Good contact wins a point; poor contact gives CPU the point. Uses 0/15/30/40, deuce and advantage; win by two points. First to two games ends each player's CPU match. Most games won ranks multiplayer results.
- **Cloud Nine Ring (boxing):** land timed strikes on the moving target to damage the CPU opponent. Both start with 100 health; B blocks and reduces return damage. Six exchanges per round, up to three rounds, or a knockout. Solo results compare remaining health; multiplayer ranks damage dealt.
- **Clover Greens (golf):** three par-3 holes. Aim slightly right and use about two-thirds power. The first stroke approaches the green; subsequent strokes putt. Good aim and power hole the ball; poor shots take extra strokes. Each hole has an eight-stroke limit. Fewest total strokes wins.
- **Comet Ballpark (baseball):** three simplified batting innings, three strikes per out, three outs per inning. Hits advance runners one to four bases; runners crossing home score runs. Each hit is followed by a CPU fielding out to keep the innings short. Bases clear between innings. Most runs wins.

These are arcade sports with original geometric canvas artwork and simplified physics. A cursor shows relative aim; the timing meter's blue band marks the ideal contact window. Results animate before the next shot or player. There is no audio or downloaded art.

## Seabreeze Kart

Choose the gold **Seabreeze Kart** channel. Up to four connected phones race at the same time on a shared overhead course. Unused positions get CPU racers. With no phones, the keyboard controls your kart against three CPUs.

- Select **Seabreeze Circuit**, **Copper Canyon**, or **Starlight Ring** from the course selector. Changing courses starts a fresh race. Courses vary in length, road width, cornering force and palette.
- After a three-second countdown, karts auto accelerate. Phone pointing or **left/right** steers across the road. **Down** brakes. Leaving the road slows the kart.
- Hold **B** while steering to charge a drift; releasing it after a sustained drift gives a short boost. **1 / Recenter** clears phone steering offset.
- Pickups are awarded at each yellow box marker when on the road and carrying no item. **A / Space / Enter** or **Use item** consumes it: **Boost** increases speed, **Shield** protects from attacks, **Spark** slows the nearest racer ahead unless shielded.
- Finish three laps. Standings show position, lap, held item and finish time. The race ends when all human racers finish; remaining CPUs show “Did not finish.” Crossing times resolve close finishes. **New match** or remote **+** after the finish races again; **Home / Escape** returns to channels.
- The keyboard controls the solo kart, otherwise an unfinished offline player's kart, otherwise the first unfinished human kart. Disconnecting releases that kart's held controls; automatic acceleration continues. Opening the pairing dialog pauses the race and releases steering/drift inputs.

Kart racing uses an arcade lane-steering model on oval courses. It does not include Nintendo characters, tracks, game assets, music, vehicle customization, grand prix progression, split-screen perspectives or console-equivalent physics.

For a solo keyboard demo, choose a channel before pairing phones. Use **left/right arrows** to aim, **A / Space** to play, **B** to charge/block, **1** to recenter, and **Escape / Home** to return. Enter launches the selected channel. The PC's on-screen Play button is another fallback.

## Tests

```powershell
npm test
```

JARVIS runs `python check.py`, which invokes the same Node tests registered in its `TESTS` list. Tests cover HTTP asset boundaries, real WebSocket pairing for four phones and rejection of a fifth, reconnection slot reuse, input limits, rumble routing, malformed frames, sports rules and completed matches, bowling bonuses, three race courses, item effects, drift boosts, crossing order, four-player controls, client syntax and remote markup. Minimal DOM harnesses run the actual dashboard launch, input, drawing, restart and home handlers, plus remote multi-touch, cancelled pointers, background sensor suppression, leaving and reconnecting. Real phone sensor permissions, gesture feel, vibration, visual appearance and LAN firewall behavior require a physical-device smoke test.

The implementation uses original game names and locally drawn art. It is not an exact replica of Wii Sports or Mario Kart: game content, rendering, physics and many modes differ. Nintendo names identify the requested inspiration only. This project is not affiliated with Nintendo.
