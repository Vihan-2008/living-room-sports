# Living Room Sports

A Wii Menu for your PC. It starts your own copies of **Wii Sports**, **Wii Sports Resort**, **Mario Kart Wii** and **Super Smash Bros. Brawl** in the Dolphin emulator. Phones become Wii Remotes, with pointer, buttons and motion. A DualSense or the keyboard works too. It also has an original arcade of five sports and a kart racer that runs in the window itself, with no games needed.

No Nintendo games, firmware or artwork are included, and this project is not affiliated with Nintendo. Use discs you own.

- [Install](#install)
- [First run](#first-run)
- [Playing](#playing)
- [Controllers](#controllers)
- [Phones](#phones)
- [Settings and saves](#settings-and-saves)
- [When something goes wrong](#when-something-goes-wrong)
- [The arcade](#the-arcade)
- [Building and tests](#building-and-tests)

## Install

### Portable build

1. Unzip `LivingRoomSports-1.0.0-portable.zip` anywhere, for example in `Documents\Games`.
2. Open **Living Room Sports.exe** from the unzipped folder.
3. Optional: run **Add Shortcuts.cmd** once to put Living Room Sports on the Desktop and in the Start menu. Run it again if you move the folder.

There is nothing else to install. Node.js is in the folder's `runtime` folder. The window is Microsoft Edge, which comes with Windows, or Chrome. The launcher is built on your PC and is not signed. If Windows SmartScreen warns about it after the zip has travelled through the internet, choose **More info › Run anyway**.

### From this source folder

Install Node.js 22 or newer, then double-click **Create Shortcut.cmd**. It builds `dist\LivingRoomSports.exe` and adds the same shortcuts. `npm run package` builds the portable folder and zip in `dist`.

## First run

Setup opens by itself the first time. You can reopen it from **Wii Options › Setup** at any time. Each step says what is missing and exactly what to do about it.

1. **Dolphin.** Dolphin is not included. Download a current version from [dolphin-emu.org](https://dolphin-emu.org) and unzip it anywhere. Then press **Find automatically**, or **Choose Dolphin.exe** to pick it yourself.
2. **Games.** Press **Add a folder** and choose the folder that holds your discs (`.iso`, `.wbfs`, `.rvz`, `.wia`, `.gcz`, `.ciso` or `.gcm`), or **Add a game file**. Each disc is recognised by the ID in its header, not its file name, and shown with the channel it belongs to. Files that cannot be read as a Wii disc are named, so you can replace them.
3. **Players.** Choose what each of the four players holds: **DualSense**, **Phone**, **Keyboard**, **Wii Remote** (a real one, connected to Dolphin) or **Off**.
4. **Phones.** Scan the code to join; see [Phones](#phones).
5. **Test.** Press buttons and move the sticks. Each controller lights up as it is used.
6. **Ready.** A summary of what is set up, and who plays with what.

Nothing is ever shown as playable unless its disc is found and readable. A channel whose game is missing still opens. Its preview names the missing piece, and **Start** opens Setup to fix it.

## Playing

The Wii Menu works like the console's. Point at a channel and press **A**, or click it, to see its preview. **Start** begins the game, and **Wii Menu** goes back. The arrows at the screen's edges, or **−** and **+**, turn the page. **Wii Options** is in the bottom-left corner and the clock is in the middle.

### Wii Sports

One channel covers both discs. **Start** opens a selector of 15 sports with 17 entries: Bowling and Golf each appear once, with **Original** and **Resort** editions to choose between. Each entry lists its players, modes and controller needs. It also says how well each kind of controller plays it.

Dolphin can start a disc but cannot choose a sport inside it. So every entry starts its game and shows the shortest menu path to the sport, for example *Press A at the wrist-strap reminder › Press A at the title screen › Choose Golf (7th of 12)*. The same steps appear on each phone. The paths follow the games' manuals. When you come back, the selector is on the sport you last played.

### Mario Kart Wii

The channel shows the game's own modes: **Grand Prix**, **Time Trials**, **VS Race** and **Battle**, each with its menu path. Online play is listed as unavailable, since Nintendo closed the service in 2014. The **Controls** tab shows the bindings for every player's controller:

| Action | DualSense | Keyboard | Phone (held like a wheel) |
| --- | --- | --- | --- |
| Steer | Left stick | ← → | Tilt the phone |
| Accelerate | ✕ Cross | X | 2 |
| Brake / reverse | □ Square | Z | 1 |
| Drift / hop | R1 or R2 | C | B |
| Use item | L1 or L2 | Space | ✚ |
| Trick / wheelie | D-pad ↑ | I | Flick the phone up |
| Pause | Options | Enter | + |

### Super Smash Bros. Brawl

The channel lists **Brawl**, **The Subspace Emissary**, **Classic** and **Training**, each with its menu path; online play is listed as unavailable. Brawl plays best on a GameCube controller and supports one natively, so a DualSense or the keyboard is one. A phone is a Wii Remote and Nunchuk, the Wii Remote style that has a stick: hold it on its side, with the stick under your left thumb and A and B under your right.

| Action | DualSense | Keyboard | Phone (Wii Remote + Nunchuk) |
| --- | --- | --- | --- |
| Move | Left stick | Arrow keys | Stick |
| Attack | ✕ Cross | X | A |
| Special move | □ Square | Z | B |
| Smash attack | Right stick | An arrow key and X together | Push the stick hard and press A |
| Jump | △ Triangle or ○ Circle | S or A | C, or push the stick up |
| Shield | L1, L2, R1 or R2 | Space or C | Z |
| Grab | Touch pad click or Create | Q | Z and A together |
| Pause | Options | Enter | + |

The first time it starts, Brawl asks to create a save file; choose **Yes**.

### While a game runs

The Wii Menu waits behind Dolphin with a **Now playing** screen. Any of these brings you back to it:

- in the game, press **Home** and choose **Wii Menu**, as on a Wii;
- press **Esc** while the game window is in front (Dolphin's Stop key);
- on a phone, open **⋯** and tap **Quit the game** twice;
- on the PC, press **Close the game** on Now playing.

Each one asks Dolphin to close the way its own close button does, so a game is never killed mid-save. Unless a Wii Menu has been installed into Dolphin from a real Wii, Dolphin has none to go to, and a game sent there would hang. The console sees that request in Dolphin's log and closes the game instead. Closing the Wii Menu window does not end a running game. The game keeps all its controllers, and the Wii Menu comes back when the game ends.

Games open on the screen chosen in **Wii Options › Dolphin › Game screen**. To move a game that is already running, press **Move to the other screen** on Now playing, or use a phone's **⋯** menu. The next game then opens on that screen too. A phone aims from wherever it faced when it was last recentred, so after a move each phone in the game says **Point at the second screen, then tap Recenter**. Brawl never uses the pointer, so it does not ask. Tapping it while pointing at the game puts the pointer back in the middle; until then it sits at the edge, and games that steer with the pointer, such as Wii Sports Resort's Swordplay and Archery, aim off to one side. Dolphin runs borderless full screen for these launches and draws the game at the size of its window, not at the Wii's own 640 × 528. It uses the smallest whole multiple of the Wii's picture that covers the screen, then fits it exactly: three times on a 1920 × 1080 screen, and four times on a 2560 × 1600 screen at 200% scaling. When the game moves to another screen, the resolution changes with it. This is Dolphin's **Auto (Window Size)** internal resolution, set only for these launches.

If Dolphin closes unexpectedly, the Wii Menu says what happened, for example a crash with Windows' error code. It also shows the end of Dolphin's log for that run. During these launches Dolphin writes its warnings to that log instead of showing pop-ups that need a mouse. None of the launch settings are saved into Dolphin's own files.

## Controllers

| | In the Wii Menu | In Wii Sports and Resort | In Mario Kart Wii | In Brawl |
| --- | --- | --- | --- | --- |
| **Phone** | Points like a Wii Remote; buttons on screen | Wii Remote with motion and MotionPlus; Nunchuk on screen when a sport needs it | Wii Wheel: hold it sideways and tilt | Wii Remote and Nunchuk: a stick and buttons on screen |
| **DualSense** | Left stick moves the hand, ✕ selects, ○ goes back, PS is Home | Wii Remote: gyro points and motion swings (R3 recentres) | GameCube controller layout | GameCube controller layout |
| **Keyboard and mouse** | Mouse, arrow keys, Enter, Esc, Page Up / Page Down | Mouse points; W A S D F R swing, Q E tilt | GameCube layout on the keyboard | GameCube layout on the keyboard |
| **Wii Remote** | — | Dolphin's own real-Wii-Remote support | Dolphin's own real-Wii-Remote support | Dolphin's own real-Wii-Remote support |

Some sports need a Nunchuk (Boxing, Archery, Power Cruising and Cycling). All of Resort needs MotionPlus. Each selector entry shows this, along with how each controller copes. Boxing, Power Cruising and Cycling expect two hands, so with one phone or a DualSense they work with limits; each entry explains how.

Wii Sports ignores a Nunchuk it does not need, so its Wii Remotes always have one. Wii Sports Resort does not: in any sport without a Nunchuk it stops and asks for the extension to be unplugged from the MotionPlus. So in Resort the Nunchuk is attached only when you start Archery, Power Cruising or Cycling. To change to a sport that needs it, or away from one, quit the game and choose the sport from the selector.

The 2-in-1 *Wii Sports + Wii Sports Resort* disc opens on its own menu, where you can choose either game whichever sport you started. So with that disc every Wii Remote has MotionPlus, which Wii Sports ignores, and the Nunchuk follows Resort's rule: it is attached only when you start Boxing, Archery, Power Cruising or Cycling.

**Wii Options › Controllers** has four tabs:

- **Players**: who plays with what.
- **Test**: shows every button and stick as it is pressed.
- **Menu buttons**: remaps the DualSense for the Wii Menu.
- **Dead zones**: one for the menu and one for games.

A DualSense that disconnects shows a notice and reconnects by itself when it is turned back on.

The console writes these layouts into Dolphin for each game and puts Dolphin's own settings back when the game ends. If you would rather set up controllers in Dolphin yourself, choose **Wii Options › Dolphin › Controller layouts › Dolphin's own**.

## Phones

Phones and iPads need the same Wi-Fi as the PC; guest networks that keep devices apart will not work. Open **Connect controllers** (the controller button in the bottom-right corner) and scan the code with each one's camera. Up to four join. Each takes the next free player number, and a phone that drops out gets its number back when it returns.

The phone shows a Wii Remote: pointer, D-pad, A, B, −, Home, +, 1 and 2. In a sport that needs a Nunchuk, and in Brawl, it adds C, Z and a stick. In Mario Kart Wii it turns into a wheel. The **⋯** button shows the menu path for the running game, recentres the pointer, moves the game to the PC's other screen, quits the game (tap twice), or leaves.

The controller follows the screen. Upright, the remote stands up. In landscape it lies across the screen with the D-pad under your left thumb and A and B under your right, and the Nunchuk sits to its left. Either way, **the top edge of the screen is the end you point at the TV**. The wheel is always wide, so on an upright screen it is drawn across and you turn the phone to hold it. The layout only changes once the phone has been still for a moment, so a swing that tips the screen does not rearrange the buttons mid-game. On an iPad everything is drawn larger, and the iPad follows the same motion steps as an iPhone.

**Motion** needs one step per phone. Phones only share motion sensors with secure pages, so each phone trusts the PC once:

1. When a phone first joins, it says **Motion is off until this phone trusts the PC** and offers **Turn on motion**.
2. That page has steps for iPhone or iPad, and for Android. It downloads the PC's certificate and walks through installing and trusting it, then checks that it worked.
3. After that, scanning the code goes straight to the secure controller with motion on. iPhones and iPads still ask for permission once with a tap, because Safari requires one.

The PC creates the certificate itself. It is limited to private network addresses, so it cannot be used to pose as a website on the internet. Buttons work without it. If Windows asks whether Node.js may use the network, allow **private networks**.

## Settings and saves

- **This app's settings**, the phone certificate and the launcher's log live in `%LOCALAPPDATA%\LivingRoomSports`. Deleting that folder resets the console; it does not touch Dolphin or your saves.
- **Your saves** stay in Dolphin's own user folder, where Dolphin keeps them. This app never moves, copies or deletes them.
- **Dolphin's settings** are left as they were. For a game it adds controller profiles named *Living Room P1…*. It also writes that game's controller entries, and records the previous values in a journal first. When the game ends the previous values go back. If the PC loses power mid-game, they go back the next time the console starts.

## When something goes wrong

| What you see | What to do |
| --- | --- |
| *Dolphin is not set up yet* | Wii Options › Setup › Dolphin: **Find automatically** or **Choose Dolphin.exe**. |
| *No game file is chosen for this channel* | Wii Options › Setup › Games: add the folder or file with that game. |
| *The game file is missing* | Reconnect the drive that holds it, or choose the file again. |
| *Dolphin is already open* | Close Dolphin, then press Start again. **Close an open Dolphin** in Wii Options › Dolphin does it for you. |
| *Dolphin closed right after starting* | The message includes the end of Dolphin's log. Usually the disc image is damaged or Dolphin is too old; update Dolphin from dolphin-emu.org. |
| A phone shows *Reconnecting…* | Check it is on the same Wi-Fi as the PC. It rejoins by itself with the same player number. |
| A phone has no motion | Open **Turn on motion** on the phone and follow it to the end. On iPhone, tap **Allow motion**. |
| The window does not open | The launcher shows a message. Details are in `%LOCALAPPDATA%\LivingRoomSports\launcher.log`. |

## The arcade

The **Living Room Sports** channel opens the original arcade. It runs in the window with no Dolphin or games, using the same phones.

- **Bluebird Lanes (bowling):** ten frames with strikes, spares and tenth-frame bonus rolls; maximum 300.
- **Sunbeam Rally (tennis):** time returns in the blue window and aim away from the opponent; first to two games. Alone you play the CPU. With two players it is singles; with three or four, two teams take turns to hit. A strong shot wins the point, a weaker one goes back over, and a miss loses it.
- **Cloud Nine Ring (boxing):** timed punches at a moving target over three rounds, or until a knockout. Alone you box the CPU, and B blocks its counters. With two players you box each other, and with three or four, two tag teams. Holding B as you punch keeps your guard up: the next punch against you lands at half strength, but so does yours.
- **Clover Greens (golf):** three par-3 holes; the first stroke approaches and later strokes putt.
- **Comet Ballpark (baseball):** three short batting innings.
- **Seabreeze Kart:** up to four phones race at once on three courses, with drift boosts and items (Boost, Shield, Spark). CPU racers fill the empty places.

On a phone, point to aim, hold B to charge and release to shoot, and shake or press 1 to recentre. On the keyboard, use the arrows to aim, A or Space to play, B to charge or block, and Escape or Home to return. In a game, Home goes back to the arcade's channels; there, Home or the **Wii Menu** button at the bottom goes back to the Wii Menu. Bowling, golf and baseball take turns at frame, hole or inning boundaries. Tennis and boxing go shot by shot between the two sides. Karts all race at once.

## Building and tests

```powershell
npm start            # the server alone, on http://localhost:3000
npm run shortcut     # build the launcher and add shortcuts
npm run package      # build dist\Living Room Sports and the portable zip
npm test
```

The launcher (`launcher\LivingRoomSports.cs`) is compiled by the C# compiler that ships with Windows. It starts the server with no console window and opens the Wii Menu in its own Edge or Chrome window, with a separate browser profile. It stops the server when the window closes, unless a game is still running. It honours **Start in full screen** from Wii Options. It also brings Dolphin's window, and later the Wii Menu, to the front, which Windows does not otherwise let a background server do.

A job being marked finished means its run ended; it does not mean every requested requirement was met. Check the job's acceptance report and evidence for each requirement. A requirement marked `not_met` or `uncertain` is still outstanding and needs follow-up before treating the requested work as complete. Passing automated checks only confirms the checks that ran; it does not override unmet requirements or owner review.

JARVIS runs `python check.py`, which runs the same Node tests. They cover:

- the console API, the setup steps and the Dolphin launch arguments, with a stand-in Dolphin;
- writing and restoring Dolphin's controller settings;
- how each kind of exit is reported, and Home › Wii Menu in a game closing it;
- which screen a game opens on, and moving it between screens of different sizes and scaling;
- the channel catalogue and the phone's game guide;
- the phone controller page, run in a fake browser: motion maths, iPhone calibration, layouts, following the screen into landscape, iPad sizing, multi-touch and reconnecting;
- the phone setup page and certificate download;
- the launcher: options, start-up, `--focus`, closing the Wii Menu during a game, and the portable build running with its own Node.js;
- the arcade's rules and pairing.

[docs/verification.md](docs/verification.md) records what was checked by hand and what still needs a real phone, a DualSense and real discs.
