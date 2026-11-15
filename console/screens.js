// The PC's screens, and moving Dolphin's game window from one to another (Windows only).
//
// Everything is measured in real pixels: a 2560 × 1600 screen at 200% scaling is 2560 × 1600 here, not the
// 1280 × 800 that a program ignoring display scaling is told. The deciding is done in this file; a small
// helper run through PowerShell only reports what Windows sees and moves the window it is told to.
import { execFile } from 'node:child_process';

const NAMES = ['Main screen', 'Second screen', 'Third screen', 'Fourth screen'];

const HELPER = String.raw`
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class LivingRoomScreens
{
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct MONITORINFOEX { public int Size; public RECT Monitor; public RECT Work; public uint Flags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string Device; }
    delegate bool MonitorProc(IntPtr monitor, IntPtr dc, ref RECT rect, IntPtr data);
    delegate bool WindowProc(IntPtr window, IntPtr data);

    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr dc, IntPtr clip, MonitorProc proc, IntPtr data);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFOEX info);
    [DllImport("shcore.dll")] static extern int GetDpiForMonitor(IntPtr monitor, int type, out uint x, out uint y);
    [DllImport("user32.dll")] static extern bool EnumWindows(WindowProc proc, IntPtr data);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out RECT rect);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr window, int index);

    // Real pixels on every screen, whatever its scaling.
    static void Aware() { SetThreadDpiAwarenessContext(new IntPtr(-4)); }
    static string Text(RECT r) { return r.Left + "," + r.Top + "," + (r.Right - r.Left) + "," + (r.Bottom - r.Top); }
    // 1 while the window has a title bar. Dolphin's full screen has none, whatever size the window is.
    static int Framed(IntPtr window) { return (GetWindowLong(window, -16) & 0x00C00000) == 0x00C00000 ? 1 : 0; }

    static string Describe(IntPtr monitor)
    {
        MONITORINFOEX info = new MONITORINFOEX();
        info.Size = Marshal.SizeOf(typeof(MONITORINFOEX));
        GetMonitorInfo(monitor, ref info);
        uint dpi, ignored;
        if (GetDpiForMonitor(monitor, 0, out dpi, out ignored) != 0) dpi = 96;
        return "screen\t" + info.Device + "\t" + ((info.Flags & 1) != 0 ? 1 : 0) + "\t" + Text(info.Monitor) + "\t" + Text(info.Work) + "\t" + dpi;
    }

    static string DeviceOf(IntPtr window)
    {
        MONITORINFOEX info = new MONITORINFOEX();
        info.Size = Marshal.SizeOf(typeof(MONITORINFOEX));
        GetMonitorInfo(MonitorFromWindow(window, 2), ref info);
        return info.Device;
    }

    public static string Screens()
    {
        Aware();
        StringBuilder lines = new StringBuilder();
        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (IntPtr monitor, IntPtr dc, ref RECT rect, IntPtr data) => { lines.Append(Describe(monitor)).Append('\n'); return true; }, IntPtr.Zero);
        return lines.ToString().TrimEnd();
    }

    // The biggest visible top-level window of the process: in batch mode that is Dolphin's game window.
    static IntPtr Largest(uint pid)
    {
        IntPtr best = IntPtr.Zero;
        long bestArea = 0;
        EnumWindows((window, data) =>
        {
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            if (owner != pid || !IsWindowVisible(window) || IsIconic(window) || GetWindow(window, 4) != IntPtr.Zero) return true;
            RECT r;
            if (!GetWindowRect(window, out r)) return true;
            long area = (long)(r.Right - r.Left) * (r.Bottom - r.Top);
            if (r.Right - r.Left >= 200 && r.Bottom - r.Top >= 150 && area > bestArea) { best = window; bestArea = area; }
            return true;
        }, IntPtr.Zero);
        return best;
    }

    // With waitMs, waits for the window to appear and keep the same place for a moment (it opens, then goes full screen).
    public static string Window(uint pid, int waitMs)
    {
        Aware();
        DateTime deadline = DateTime.UtcNow.AddMilliseconds(waitMs);
        IntPtr last = IntPtr.Zero;
        string lastPlace = null;
        while (true)
        {
            IntPtr window = Largest(pid);
            string place = null;
            RECT r;
            if (window != IntPtr.Zero && GetWindowRect(window, out r)) place = Text(r);
            bool settled = place != null && (waitMs <= 0 || (window == last && place == lastPlace));
            if (settled || DateTime.UtcNow >= deadline)
                return place == null ? "" : "window\t" + window.ToInt64() + "\t" + place + "\t" + DeviceOf(window) + "\t" + Framed(window);
            last = window;
            lastPlace = place;
            Thread.Sleep(500);
        }
    }

    // Moving onto a screen with different scaling makes the window rescale itself, so the place is set again until it
    // holds. If Dolphin takes the window into or out of full screen meanwhile, setting the place again would undo
    // that, so it stops there and reports what the window became.
    public static string Move(long handle, int x, int y, int width, int height)
    {
        Aware();
        IntPtr window = new IntPtr(handle);
        RECT r = new RECT();
        int framed = Framed(window);
        for (int attempt = 0; attempt < 5; attempt++)
        {
            SetWindowPos(window, IntPtr.Zero, x, y, width, height, 0x0004 | 0x0010 | 0x0200);
            Thread.Sleep(200);
            if (!GetWindowRect(window, out r)) return "";
            if (Framed(window) != framed) break;
            if (r.Left == x && r.Top == y && r.Right - r.Left == width && r.Bottom - r.Top == height) break;
        }
        return "moved\t" + Text(r) + "\t" + DeviceOf(window) + "\t" + Framed(window);
    }
}
'@
[LivingRoomScreens]::Screens()
switch ($env:LRS_DO) {
  'window' { [LivingRoomScreens]::Window([uint32]$env:LRS_PID, [int]$env:LRS_WAIT) }
  'move' { $r = $env:LRS_RECT.Split(','); [LivingRoomScreens]::Move([long]$env:LRS_WINDOW, [int]$r[0], [int]$r[1], [int]$r[2], [int]$r[3]) }
}
`;

function rect(text) {
  const [x, y, width, height] = String(text).split(',').map(Number);
  return [x, y, width, height].every(Number.isFinite) ? { x, y, width, height } : null;
}

// Screens come back main screen first, then left to right, each with the name the menu shows.
export function parseHelper(text) {
  const screens = [];
  let window = null, moved = null;
  for (const line of String(text).split(/\r?\n/)) {
    const [kind, ...fields] = line.trim().split('\t');
    if (kind === 'screen' && fields.length === 5) {
      const [id, primary, bounds, work, dpi] = fields;
      const box = rect(bounds), area = rect(work);
      if (box && area) screens.push({ id, primary: primary === '1', ...box, work: area, scale: (Number(dpi) || 96) / 96 });
    } else if (kind === 'window' && fields.length === 4) {
      const box = rect(fields[1]);
      if (box) window = { handle: fields[0], ...box, screen: fields[2], framed: fields[3] === '1' };
    } else if (kind === 'moved' && fields.length === 3) {
      const box = rect(fields[0]);
      if (box) moved = { ...box, screen: fields[1], framed: fields[2] === '1' };
    }
  }
  screens.sort((a, b) => (b.primary - a.primary) || a.x - b.x || a.y - b.y);
  screens.forEach((screen, i) => { screen.name = NAMES[i] || `Screen ${i + 1}`; });
  return { screens, window, moved };
}

// choice: 'main', or a screen's id. A screen that has been unplugged falls back to the main screen.
export function findScreen(screens, choice) {
  return screens.find(s => s.id === choice) || screens.find(s => s.primary) || screens[0] || null;
}

export function nextScreen(screens, currentId) {
  if (screens.length < 2) return null;
  const index = screens.findIndex(s => s.id === currentId);
  return screens[(index + 1) % screens.length];
}

const near = (a, b, slack) => Math.abs(a - b) <= slack;
export function fillsScreen(window, screen) {
  return near(window.x, screen.x, 2) && near(window.y, screen.y, 2) && near(window.width, screen.width, 4) && near(window.height, screen.height, 4);
}

// Where the window goes on `to`. A full-screen game fills the new screen exactly; a windowed one keeps the size it
// looks on screen (so it doubles going onto a 200% screen), shrinks to fit if it must, and sits in the middle.
// A window with no title bar is full screen even when it does not fill its screen: one moved while Dolphin was
// going full screen can be left that way, and filling the screen puts it right.
export function placeWindow(window, from, to) {
  if (window.framed === false || fillsScreen(window, from)) return { x: to.x, y: to.y, width: to.width, height: to.height };
  const ratio = to.scale / (from.scale || 1);
  const width = Math.min(Math.round(window.width * ratio), to.work.width);
  const height = Math.min(Math.round(window.height * ratio), to.work.height);
  return { x: to.work.x + Math.round((to.work.width - width) / 2), y: to.work.y + Math.round((to.work.height - height) / 2), width, height };
}

function runHelper(env) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(HELPER, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: 45000, encoding: 'utf8', env: { ...process.env, ...env } },
      (error, stdout) => (error ? reject(new Error('Windows did not report its screens.')) : resolve(stdout)));
  });
}

export class ScreenError extends Error {
  constructor(code, message, step = null) { super(message); this.code = code; this.step = step; this.status = 409; }
}

// run(env) runs the helper and resolves to its output; tests pass their own.
export function createDisplays({ run = process.platform === 'win32' ? runHelper : null, onChange = () => {} } = {}) {
  let current = [];
  async function ask(env) {
    if (!run) throw new ScreenError('unsupported', 'Moving the game between screens needs Windows.');
    const result = parseHelper(await run(env));
    if (JSON.stringify(result.screens) !== JSON.stringify(current)) { current = result.screens; onChange(current); }
    return result;
  }
  return {
    get screens() { return current; },
    list: async () => (await ask({ LRS_DO: 'screens' })).screens,
    // The game window of process `pid`; waitMs > 0 waits for it to open and settle.
    gameWindow: (pid, waitMs = 0) => ask({ LRS_DO: 'window', LRS_PID: String(pid), LRS_WAIT: String(waitMs) }),
    move: (handle, place) => ask({ LRS_DO: 'move', LRS_WINDOW: String(handle), LRS_RECT: [place.x, place.y, place.width, place.height].join(',') })
  };
}
