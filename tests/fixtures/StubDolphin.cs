// A stand-in for Dolphin.exe, used to verify the console without Dolphin or any game.
// It records its command line, writes a Dolphin-style log into the user folder it was given, shows a
// small window, and closes like Dolphin when asked (WM_CLOSE). Set LRS_STUB_CRASH=1 to make it crash
// two seconds after starting, with the access-violation exit code Windows gives a crashed program.
using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyInformationalVersion("5.0-stub")]
[assembly: AssemblyFileVersion("5.0.0.0")]
[assembly: AssemblyTitle("Stub Dolphin")]

static class StubDolphin
{
    [STAThread]
    static int Main(string[] args)
    {
        string exeDir = AppDomain.CurrentDomain.BaseDirectory;
        int u = Array.IndexOf(args, "-u"), e = Array.IndexOf(args, "-e");
        string userDir = u >= 0 && u + 1 < args.Length ? args[u + 1] : Path.Combine(exeDir, "User");
        string game = e >= 0 && e + 1 < args.Length ? args[e + 1] : null;
        File.AppendAllText(Path.Combine(exeDir, "launches.log"), DateTime.Now.ToString("s") + "\t" + string.Join("\t", args) + Environment.NewLine);
        Directory.CreateDirectory(Path.Combine(userDir, "Logs"));
        string log = Path.Combine(userDir, "Logs", "dolphin.log");
        File.AppendAllText(log, "Core: Stub Dolphin started with " + (game ?? "no game") + Environment.NewLine);
        if (game == null || !File.Exists(game))
        {
            File.AppendAllText(log, "Core: Could not open the game file" + Environment.NewLine);
            return 1;
        }
        var form = new Form { Text = "Stub Dolphin - " + Path.GetFileName(game), Width = 520, Height = 220, StartPosition = FormStartPosition.Manual, Left = 40, Top = 40 };
        string settings = string.Join(Environment.NewLine, args.Where(a => a.Contains("=")).Take(8));
        form.Controls.Add(new Label { Dock = DockStyle.Fill, Text = "Running " + Path.GetFileName(game) + Environment.NewLine + settings, Padding = new Padding(12) });
        form.KeyPreview = true;
        form.KeyDown += (s, k) => { if (k.KeyCode == Keys.Escape) form.Close(); };
        if (Environment.GetEnvironmentVariable("LRS_STUB_CRASH") == "1")
        {
            var timer = new Timer { Interval = 2000 };
            timer.Tick += (s, k) => { File.AppendAllText(log, "Core: Invalid read from 0x00000000" + Environment.NewLine); Environment.Exit(unchecked((int)0xC0000005)); };
            timer.Start();
        }
        Application.Run(form);
        File.AppendAllText(log, "Core: Stopped" + Environment.NewLine);
        return 0;
    }
}
