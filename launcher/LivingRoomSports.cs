// Desktop launcher for Living Room Sports.
//
// Double-clicking the shortcut runs this program. It starts the game server (node server.js) with no
// console window, opens the dashboard in its own app window (Edge or Chrome, no tabs or address bar),
// and stops the server when that window closes. A second launch brings the open window to the front.
//
// Built by launcher\install.ps1 with the C# compiler that ships with Windows (.NET Framework 4), so this
// file sticks to C# 5. Options (mainly for tests):
//   --check            start (or find) the server, confirm it answers, prepare the browser profile,
//                      then stop; no window, no dialogs
//   --port <n>         server port (default 3000)
//   --project <dir>    folder holding server.js (default: found by walking up from this .exe)
//   --data-dir <dir>   where the log and browser profile live (default %LOCALAPPDATA%\LivingRoomSports)
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Living Room Sports")]
[assembly: AssemblyProduct("Living Room Sports")]
[assembly: AssemblyDescription("Starts the Living Room Sports server and opens the dashboard in its own window.")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

static class Launcher
{
    const string AppName = "Living Room Sports";
    static readonly object LogLock = new object();
    static StreamWriter log;
    static string logPath;
    static bool checkOnly;

    enum Probe { Free, Ours, Other }

    [STAThread]
    static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        int port = 3000;
        string project = null, dataDir = null, argError = null;
        for (int i = 0; i < args.Length; i++)
        {
            string a = args[i];
            if (a == "--check") checkOnly = true;
            else if (a == "--port" && i + 1 < args.Length)
            {
                if (!int.TryParse(args[++i], out port) || port < 1 || port > 65535) argError = "Invalid --port value.";
            }
            else if (a == "--project" && i + 1 < args.Length) project = args[++i];
            else if (a == "--data-dir" && i + 1 < args.Length) dataDir = args[++i];
            else argError = "Unknown option: " + a;
        }
        if (argError != null) return Fail(argError);

        if (dataDir == null)
            dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LivingRoomSports");
        project = project != null ? Path.GetFullPath(project) : FindProject();
        if (project == null || !IsProject(project))
            return Fail("Could not find the game files (server.js and public\\index.html).\n\n" +
                        "Keep LivingRoomSports.exe in the project's dist folder, or run \"Create Shortcut.cmd\" in the project folder again.");

        bool firstInstance;
        using (Mutex mutex = new Mutex(true, @"Local\LivingRoomSports-" + port, out firstInstance))
        {
            if (!firstInstance)
            {
                if (checkOnly) return Fail("Another launcher is already using port " + port + ".");
                // Already open: let the running launcher bring its window to the front.
                AllowSetForegroundWindow(-1);
                try { using (EventWaitHandle show = EventWaitHandle.OpenExisting(ShowEventName(port))) show.Set(); }
                catch (WaitHandleCannotBeOpenedException) { }
                return 0;
            }
            try { return Run(port, project, dataDir); }
            finally { mutex.ReleaseMutex(); }
        }
    }

    static int Run(int port, string project, string dataDir)
    {
        Directory.CreateDirectory(dataDir);
        logPath = Path.Combine(dataDir, "launcher.log");
        log = new StreamWriter(logPath, false, new UTF8Encoding(false));
        log.AutoFlush = true;
        Log(AppName + " launcher " + Assembly.GetExecutingAssembly().GetName().Version);
        Log("Project: " + project);

        string url = "http://localhost:" + port + "/";
        Process server = null;
        // Everything the launcher starts goes in this job: if the launcher is killed, Windows ends it all.
        IntPtr job = CreateKillOnCloseJob();
        if (job == IntPtr.Zero) Log("Warning: could not create a job object (error " + Marshal.GetLastWin32Error() + ").");
        try
        {
            Probe state = ProbeServer(port);
            if (state == Probe.Ours) Log("Server already running on port " + port + "; reusing it.");
            else if (state == Probe.Other)
                return Fail("Port " + port + " is already in use by another program. Close that program and try again.");
            else
            {
                string node = FindNode();
                if (node == null)
                    return Fail("Node.js was not found. Install Node.js 22 or newer from https://nodejs.org, then try again.");
                server = StartServer(node, project, port, job);
                if (!WaitForServer(server, port, TimeSpan.FromSeconds(20)))
                    return Fail(server.HasExited
                        ? "The game server stopped while starting (exit code " + server.ExitCode + ")."
                        : "The game server did not start within 20 seconds.");
                Log("Server ready: " + url);
            }
            string profile = Path.Combine(dataDir, "browser-profile");
            if (!ProfileInUse(profile)) DisableBackgroundMode(profile);
            if (checkOnly) { Log("Check passed."); return 0; }
            ShowApp(url, profile, port, job);
            return 0;
        }
        catch (Exception e)
        {
            return Fail("Unexpected error: " + e.Message);
        }
        finally
        {
            StopServer(server);
            if (job != IntPtr.Zero) CloseHandle(job);
            Log("Launcher exiting.");
            lock (LogLock) { log.Dispose(); log = null; }
        }
    }

    // ---- Server ---------------------------------------------------------------------------------

    static Probe ProbeServer(int port)
    {
        // Read the listener table first: on Windows a refused local connection takes about two seconds.
        bool listening = false;
        foreach (IPEndPoint endpoint in IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners())
            if (endpoint.Port == port) { listening = true; break; }
        if (!listening) return Probe.Free;
        try
        {
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/config");
            req.Proxy = null;
            req.Timeout = 5000;
            req.ReadWriteTimeout = 5000;
            req.KeepAlive = false;
            using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
            using (StreamReader reader = new StreamReader(res.GetResponseStream()))
            {
                string body = reader.ReadToEnd();
                return body.Contains("\"code\"") && body.Contains("\"addresses\"") ? Probe.Ours : Probe.Other;
            }
        }
        catch (WebException)
        {
            return Probe.Other;
        }
    }

    static Process StartServer(string node, string project, int port, IntPtr job)
    {
        ProcessStartInfo psi = new ProcessStartInfo(node, "\"" + Path.Combine(project, "server.js") + "\"");
        psi.WorkingDirectory = project;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.StandardOutputEncoding = Encoding.UTF8;
        psi.StandardErrorEncoding = Encoding.UTF8;
        psi.EnvironmentVariables["PORT"] = port.ToString();
        Process p = new Process();
        p.StartInfo = psi;
        p.OutputDataReceived += (s, e) => { if (e.Data != null) Log("[server] " + e.Data); };
        p.ErrorDataReceived += (s, e) => { if (e.Data != null) Log("[server] " + e.Data); };
        p.Start();
        AddToJob(job, p, "server");
        p.BeginOutputReadLine();
        p.BeginErrorReadLine();
        Log("Started server (pid " + p.Id + ") with " + node);
        return p;
    }

    static bool WaitForServer(Process server, int port, TimeSpan limit)
    {
        DateTime deadline = DateTime.UtcNow + limit;
        while (DateTime.UtcNow < deadline)
        {
            if (ProbeServer(port) == Probe.Ours) return true;
            if (server.HasExited) return false;
            Thread.Sleep(150);
        }
        return false;
    }

    static void StopServer(Process server)
    {
        if (server == null) return;
        try
        {
            if (!server.HasExited)
            {
                Log("Stopping server.");
                server.Kill();
            }
            if (server.WaitForExit(5000)) server.WaitForExit(); // second call drains the output readers
        }
        catch (Exception e) { Log("Could not stop server: " + e.Message); }
    }

    static string FindNode()
    {
        string path = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (string entry in path.Split(';'))
        {
            string dir = entry.Trim().Trim('"');
            if (dir.Length == 0) continue;
            try
            {
                string candidate = Path.Combine(Environment.ExpandEnvironmentVariables(dir), "node.exe");
                if (File.Exists(candidate)) return candidate;
            }
            catch (ArgumentException) { }
        }
        string[] extras = {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"nodejs\node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"nodejs\node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\nodejs\node.exe"),
            Path.Combine(Environment.GetEnvironmentVariable("NVM_SYMLINK") ?? "", "node.exe")
        };
        foreach (string candidate in extras)
            if (Path.IsPathRooted(candidate) && File.Exists(candidate)) return candidate;
        return null;
    }

    static string FindProject()
    {
        string dir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        for (int i = 0; i < 4 && dir != null; i++, dir = Path.GetDirectoryName(dir))
            if (IsProject(dir)) return dir;
        return null;
    }

    static bool IsProject(string dir)
    {
        return File.Exists(Path.Combine(dir, "server.js")) && File.Exists(Path.Combine(dir, @"public\index.html"));
    }

    // ---- App window ---------------------------------------------------------------------------------

    static void ShowApp(string url, string profile, int port, IntPtr job)
    {
        string browser = FindBrowser();
        if (browser == null)
        {
            Log("Edge and Chrome were not found; opening the default browser.");
            Process.Start(url);
            MessageBox.Show(AppName + " is open in your web browser.\n\nKeep this message open while you play. Click OK to stop the game server.",
                AppName, MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        // A separate browser profile gives the game its own window and process, so closing the window
        // ends this launcher (and the server) without touching the person's normal browser.
        string args = "--app=" + url + " --user-data-dir=\"" + profile + "\" --no-first-run --no-default-browser-check --start-maximized";
        Log("Opening app window: " + browser + " " + args);
        using (EventWaitHandle showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, ShowEventName(port)))
        using (ManualResetEvent closed = new ManualResetEvent(false))
        {
            ProcessStartInfo psi = new ProcessStartInfo(browser, args);
            psi.UseShellExecute = false;
            Process window = Process.Start(psi);
            AddToJob(job, window, "browser");
            Thread focus = new Thread(() =>
            {
                WaitHandle[] handles = { closed, showEvent };
                while (WaitHandle.WaitAny(handles) == 1) BringToFront(window);
            });
            focus.IsBackground = true;
            focus.Start();

            WaitForAppToClose(window, profile);
            Log("App window closed.");
            closed.Set();
            focus.Join();
        }
    }

    static void WaitForAppToClose(Process window, string profile)
    {
        // Normally the browser exits with its window (background mode is off in this profile). If it keeps
        // running hidden anyway, end it once the window has been gone for a few seconds, so the server stops
        // and the next launch opens a fresh window.
        bool seen = false;
        int ticks = 0;
        while (!window.WaitForExit(250))
        {
            if (HasWindow(window)) { seen = true; ticks = 0; continue; }
            ticks++;
            if ((seen && ticks >= 16) || (!seen && ticks >= 240))
            {
                Log(seen ? "App window closed but the browser kept running; ending it." : "App window never appeared; ending the browser.");
                try { window.Kill(); window.WaitForExit(5000); }
                catch (InvalidOperationException) { }
                catch (Win32Exception) { }
                break;
            }
        }
        // Chromium can hand the window to a browser process already running on this profile,
        // so the profile lock is the reliable sign that the game window is still open.
        while (ProfileInUse(profile)) Thread.Sleep(500);
    }

    static bool HasWindow(Process window)
    {
        try { window.Refresh(); return !window.HasExited && window.MainWindowHandle != IntPtr.Zero; }
        catch (InvalidOperationException) { return false; }
    }

    // Chromium-based browsers can keep running in the background after their last window closes, which
    // would keep this launcher (and the server) running with nothing on screen. Turn that off for the
    // game's own profile; the person's normal browser profile is never touched.
    static void DisableBackgroundMode(string profile)
    {
        string path = Path.Combine(profile, "Local State");
        try
        {
            Directory.CreateDirectory(profile);
            JavaScriptSerializer json = new JavaScriptSerializer();
            json.MaxJsonLength = int.MaxValue;
            Dictionary<string, object> state = File.Exists(path)
                ? json.Deserialize<Dictionary<string, object>>(File.ReadAllText(path, Encoding.UTF8)) : null;
            if (state == null) state = new Dictionary<string, object>();
            object value;
            Dictionary<string, object> mode = state.TryGetValue("background_mode", out value) ? value as Dictionary<string, object> : null;
            if (mode != null && mode.TryGetValue("enabled", out value) && false.Equals(value)) return;
            if (mode == null) state["background_mode"] = mode = new Dictionary<string, object>();
            mode["enabled"] = false;
            File.WriteAllText(path, json.Serialize(state), new UTF8Encoding(false));
            Log("Turned off background mode for the game's browser profile.");
        }
        catch (Exception e) { Log("Warning: could not update " + path + ": " + e.Message); }
    }

    static string FindBrowser()
    {
        string x86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        string x64 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string[] candidates = {
            Path.Combine(x86, @"Microsoft\Edge\Application\msedge.exe"),
            Path.Combine(x64, @"Microsoft\Edge\Application\msedge.exe"),
            AppPath("msedge.exe"),
            Path.Combine(x64, @"Google\Chrome\Application\chrome.exe"),
            Path.Combine(x86, @"Google\Chrome\Application\chrome.exe"),
            Path.Combine(local, @"Google\Chrome\Application\chrome.exe"),
            AppPath("chrome.exe")
        };
        foreach (string candidate in candidates)
            if (!string.IsNullOrEmpty(candidate) && File.Exists(candidate)) return candidate;
        return null;
    }

    static string AppPath(string exe)
    {
        foreach (RegistryKey hive in new[] { Registry.CurrentUser, Registry.LocalMachine })
        {
            using (RegistryKey key = hive.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" + exe))
            {
                string value = key == null ? null : key.GetValue("") as string;
                if (!string.IsNullOrEmpty(value)) return value.Trim('"');
            }
        }
        return null;
    }

    static bool ProfileInUse(string profile)
    {
        // Chromium holds <profile>\lockfile open (and deletes it on exit) while the browser runs.
        string lockFile = Path.Combine(profile, "lockfile");
        if (!File.Exists(lockFile)) return false;
        try
        {
            using (new FileStream(lockFile, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) { }
            return false;
        }
        catch (IOException) { return true; }
        catch (UnauthorizedAccessException) { return true; }
    }

    static void BringToFront(Process window)
    {
        try
        {
            if (window.HasExited) return;
            window.Refresh();
            IntPtr handle = window.MainWindowHandle;
            if (handle == IntPtr.Zero) return;
            if (IsIconic(handle)) ShowWindow(handle, 9 /* SW_RESTORE */);
            SetForegroundWindow(handle);
        }
        catch (InvalidOperationException) { }
    }

    static string ShowEventName(int port) { return @"Local\LivingRoomSports-Show-" + port; }

    // ---- Messages -----------------------------------------------------------------------------------

    static void Log(string message)
    {
        lock (LogLock)
        {
            if (log != null) log.WriteLine(DateTime.Now.ToString("HH:mm:ss.fff") + "  " + message);
        }
    }

    static int Fail(string message)
    {
        Log("ERROR: " + message);
        if (!checkOnly)
            MessageBox.Show(message + (logPath != null ? "\n\nDetails: " + logPath : ""), AppName,
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        return 1;
    }

    // ---- Win32 --------------------------------------------------------------------------------------

    static void AddToJob(IntPtr job, Process process, string what)
    {
        if (job != IntPtr.Zero && !AssignProcessToJobObject(job, process.Handle))
            Log("Warning: could not tie the " + what + " to the launcher (error " + Marshal.GetLastWin32Error() + ").");
    }

    static IntPtr CreateKillOnCloseJob()
    {
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) return IntPtr.Zero;
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        info.BasicLimitInformation.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if (!SetInformationJobObject(job, 9 /* JobObjectExtendedLimitInformation */, ref info,
                (uint)Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION))))
        {
            CloseHandle(job);
            return IntPtr.Zero;
        }
        return job;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct IO_COUNTERS
    {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, uint length);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);
    [DllImport("user32.dll")]
    static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")]
    static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")]
    static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")]
    static extern bool AllowSetForegroundWindow(int processId);
}
