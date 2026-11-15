# Living Room Sports

A Wii-inspired living room dashboard, four phone remotes, and five small original sports games. Plain HTML, CSS and JavaScript; a dependency-free Node HTTP/WebSocket server. Everything is served locally, with no accounts or external assets.

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
5. On the PC choose a channel, or use the remote D-pad and A. Players connected when the match starts take three turns each. New arrivals join the next match. An offline player's turn can be completed from the PC keyboard; **New match** rebuilds the roster. Highest total wins; ties are shared.

## Motion sensors and HTTPS

**LAN HTTP works for pairing and all buttons. Most mobile browsers block motion sensors on HTTP.** This is a browser restriction, and cannot be bypassed by JavaScript. Tap **Enable motion** on the remote to request both DeviceMotion and DeviceOrientation permissions, including the iOS permission dialogs. Hold the phone upright, then tap **Recenter**. The remote reports whether actual sensor data arrives. Permission denial, missing sensors and insecure pages fall back to buttons.

For phone motion, the owner must supply a **trusted HTTPS local endpoint** that proxies this app's HTTP and `/ws` WebSocket traffic to port 3000. Open the dashboard and remotes through that same HTTPS endpoint (phone path `/remote?code=ROOMCODE`; copy the room code displayed on the dashboard). The automatic links show direct HTTP addresses; replace their scheme/host with the HTTPS endpoint. Its certificate must be trusted by each phone, and its proxy must preserve the public Host/Origin relationship for WebSocket upgrade requests. Self-signed certificate warnings alone may not enable sensors. This project does not generate, read, or manage certificates or keys, configure a proxy, or deploy services. On Android Chrome, a development alternative is the browser's “Insecure origins treated as secure” setting for the exact local HTTP origin; this changes browser security and should be reverted after local testing. iOS generally needs trusted HTTPS.

Device capabilities vary. The browser exposes orientation and acceleration, not a real infrared pointer or a calibrated console controller. Pointing uses relative yaw, swings use acceleration thresholds, and a strong shake recentres. Vibration feedback is best-effort using `navigator.vibrate`; iOS browsers commonly do not support it. Keep a comfortable grip and room to move; gentle gestures suffice.

## Remote and games

The elongated white remote has a round D-pad housing, A, minus, Home, plus, 1 and 2 buttons, four player lights, and a labelled underside B-trigger panel (accessible on the front of the phone screen).

- **D-pad left/right:** choose a channel or adjust aim. **A / 2:** launch or play. **Home:** return to menu. **− / +:** previous/next channel; + starts a new match after the result.
- **Point:** aim with orientation. **Hold B:** charge a shot; release to shoot in bowling/golf. In boxing B blocks and widens the timing window. **Shake / 1:** recenter. A uses the visible power meter, so motion is optional.
- **Bluebird Lanes (bowling):** aim down the lane and release a controlled roll. Up to ten pins per turn.
- **Sunbeam Rally (tennis):** track the moving opponent and return the ball in the blue timing window. Up to ten points per turn.
- **Cloud Nine Ring (boxing):** aim at the moving training pad and time a punch. Blocking improves timing forgiveness. Up to ten points per turn.
- **Clover Greens (golf):** aim slightly right toward the flag and match the power to the distance (about two-thirds). Closer shots earn up to thirty points.
- **Comet Ballpark (baseball):** time the pitch and swing into fair territory. Contact quality and power earn zero to four bases.

These are short, arcade turn-based skill challenges with original geometric canvas artwork, rather than full simulations. A cursor shows relative aim; the timing meter's blue band marks the ideal contact window. Results animate, then the next player takes a turn. There is no audio or downloaded art.

For a solo keyboard demo, choose a channel before pairing phones. Use **left/right arrows** to aim, **A / Space** to play, **B** to charge/block, **1** to recenter, and **Escape / Home** to return. Enter launches the selected channel. The PC's on-screen Play button is another fallback.

## Tests

```powershell
npm test
```

JARVIS runs `python check.py`, which invokes the same Node tests. Tests cover HTTP asset boundaries, real WebSocket pairing for four phones and rejection of a fifth, reconnection slot reuse, input limits, rumble routing, malformed frames, sports scoring, three-round rotation, client syntax and remote control markup. Real phone sensor permissions, gesture feel, vibration, visual appearance and LAN firewall behavior require a physical-device smoke test.

All names, game art and code in this project are original. A pixel-exact copy of Wii Sports is not included because it is Nintendo's copyrighted game; these original games cover the same kinds of sports. Nintendo names identify the requested inspiration only. This project is not affiliated with Nintendo.
