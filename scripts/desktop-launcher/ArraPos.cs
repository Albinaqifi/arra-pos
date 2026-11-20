using System;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: AssemblyTitle("Arra POS")]
[assembly: AssemblyProduct("Arra POS")]
[assembly: AssemblyDescription("Desktop launcher for the restaurant RC4 release")]
[assembly: AssemblyFileVersion("1.0.10.4")]
[assembly: AssemblyVersion("1.0.10.4")]

internal sealed class PrinterProfile
{
    // These names match the existing RC4 private stdin protocol.
    public string dataDirectory { get; set; }
    public string expectedSerial { get; set; }
    public int operatorNumber { get; set; }
    public string tillNumber { get; set; }
    public string operatorPassword { get; set; }
    public bool domesticProduct { get; set; }

    internal bool ValidFor(string directory)
    {
        return String.Equals(directory, dataDirectory, StringComparison.OrdinalIgnoreCase) &&
            Regex.IsMatch(expectedSerial ?? "", @"\A[A-Za-z0-9]{11}\z") &&
            operatorNumber >= 1 && operatorNumber <= 8 &&
            Regex.IsMatch(tillNumber ?? "", @"\A[0-9]{1,5}\z") &&
            Regex.IsMatch(operatorPassword ?? "", @"\A[0-9]{4,6}\z") && !domesticProduct;
    }

    internal byte[] Encode()
    {
        return Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(this));
    }
}

internal static class ArraPos
{
    internal const string Title = "Arra POS";
    private const string ProfileFolder = "Arra POS PF700 Commissioning";

    private sealed class LauncherException : Exception
    {
        internal LauncherException(string message) : base(message) { }
    }

    [STAThread]
    private static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        bool open = args.Length == 1 && args[0] == "--open";
        if (!open && args.Length != 0 && !(args.Length == 1 && args[0] == "--setup")) return 1;

        try
        {
            using (var mutex = new Mutex(false, @"Local\ArraPosRC4Launcher-" + WindowsIdentity.GetCurrent().User.Value))
            {
                bool owned;
                try { owned = mutex.WaitOne(0); }
                catch (AbandonedMutexException) { owned = true; }
                if (!owned) throw new LauncherException("Arra POS is already open. Switch back to its window.");
                try { Run(open); }
                finally { mutex.ReleaseMutex(); }
            }
            return 0;
        }
        catch (LauncherException error)
        {
            MessageBox.Show(error.Message, Title, MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch
        {
            MessageBox.Show("Windows could not complete this action. Close any older Arra window and open Arra POS.exe from the extracted RC4 folder to run setup again.",
                Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        return 1;
    }

    private static string AppData(string name)
    {
        string path = Environment.GetEnvironmentVariable(name);
        if (String.IsNullOrEmpty(path) || !Path.IsPathRooted(path))
            throw new LauncherException("Sign in to the Windows account used for the restaurant POS.");
        return Path.GetFullPath(path);
    }

    private static void Run(bool open)
    {
        string exe = Application.ExecutablePath;
        string kit = Path.GetDirectoryName(exe);
        try { ReleaseFiles.Verify(kit); }
        catch
        {
            throw new LauncherException("Place Arra POS.exe in the extracted restaurant RC4 folder, beside Open-Arra-Pay.cmd and the program folder. If it is already there, extract a fresh copy of the verified RC4 ZIP.");
        }

        string local = AppData("LOCALAPPDATA");
        string directory = Path.Combine(AppData("APPDATA"), ProfileFolder);
        if (!File.Exists(Path.Combine(directory, "arra.sqlite")) ||
            File.Exists(Path.Combine(directory, "SAMPLE-DATA-ONLY")) || Directory.Exists(Path.Combine(directory, "SAMPLE-DATA-ONLY")))
            throw new LauncherException("The existing restaurant profile was not found. Use the Windows account that ran RC4 on the enrolled POS PC.");

        string settings = Path.Combine(local, "Arra POS", "Desktop launcher", "rc4.profile");
        if (open && File.Exists(settings))
        {
            PrinterProfile profile;
            try { profile = ReadProfile(settings, directory); }
            catch
            {
                throw new LauncherException("The saved printer settings could not be opened for this Windows account. Open Arra POS.exe in the RC4 folder to set them up again.");
            }
            CheckDeviceClaim(profile.expectedSerial, local);
            Launch(kit, profile);
            return;
        }

        using (var setup = new PrinterSetup(directory))
        {
            while (setup.ShowDialog() == DialogResult.OK)
            {
                try
                {
                    PrinterProfile profile = setup.Profile;
                    CheckDeviceClaim(profile.expectedSerial, local);
                    string link = SaveSetup(profile, settings, Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), exe);
                    MessageBox.Show("Setup is complete. Open " + Path.GetFileNameWithoutExtension(link) +
                        " on your desktop to start checkout.", Title, MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
                catch (LauncherException error)
                {
                    MessageBox.Show(error.Message, Title, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
                catch
                {
                    MessageBox.Show("The desktop shortcut or protected settings could not be saved. Check that your desktop and local app data folder are writable, then try again.",
                        Title, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
            }
        }
    }

    private static void CheckDeviceClaim(string serial, string local)
    {
        string digest;
        using (var hash = SHA256.Create())
            digest = BitConverter.ToString(hash.ComputeHash(Encoding.ASCII.GetBytes(serial))).Replace("-", "").ToLowerInvariant();
        var marker = new FileInfo(Path.Combine(local, "Arra POS", "PF700 commissioning", digest + ".used"));
        if (!marker.Exists || marker.Length != 0 || (marker.Attributes & FileAttributes.ReparsePoint) != 0)
            throw new LauncherException("This printer serial does not match an enrolled printer in this Windows account. Check the serial on the PF700 and use the original POS account.");
    }

    internal static PrinterProfile ReadProfile(string file, string directory)
    {
        if (new FileInfo(file).Length > 8192) throw new InvalidDataException();
        byte[] plain = ProtectedData.Unprotect(File.ReadAllBytes(file), null, DataProtectionScope.CurrentUser);
        try
        {
            var value = new JavaScriptSerializer().Deserialize<PrinterProfile>(Encoding.UTF8.GetString(plain));
            if (value == null || !value.ValidFor(directory)) throw new InvalidDataException();
            return value;
        }
        finally { Array.Clear(plain, 0, plain.Length); }
    }

    internal static string SaveSetup(PrinterProfile profile, string file, string desktop, string exe)
    {
        if (!profile.ValidFor(profile.dataDirectory) || !Path.IsPathRooted(profile.dataDirectory))
            throw new InvalidDataException();
        if (!Directory.Exists(desktop)) throw new DirectoryNotFoundException();
        byte[] plain = profile.Encode();
        byte[] encrypted;
        try { encrypted = ProtectedData.Protect(plain, null, DataProtectionScope.CurrentUser); }
        finally { Array.Clear(plain, 0, plain.Length); }
        Directory.CreateDirectory(Path.GetDirectoryName(file));
        string temp = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            using (var output = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                output.Write(encrypted, 0, encrypted.Length);
                output.Flush(true);
            }
            // Only publish the new settings when Windows can provide the shortcut.
            // An interrupted first setup can be repeated from either entry point.
            string shortcut = DesktopShortcut(desktop, exe);
            if (File.Exists(file)) File.Replace(temp, file, null);
            else File.Move(temp, file);
            return shortcut;
        }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }

    internal static string DesktopShortcut(string desktop, string exe)
    {
        dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell", true));
        try
        {
            for (int n = 1; ; n++)
            {
                string name = n == 1 ? Title : Title + " (RC4" + (n == 2 ? "" : " " + (n - 1)) + ")";
                string path = Path.Combine(desktop, name + ".lnk");
                if (Directory.Exists(path)) continue;
                bool exists = File.Exists(path);
                if (exists)
                {
                    dynamic current = shell.CreateShortcut(path);
                    try
                    {
                        if (String.Equals((string)current.TargetPath, exe, StringComparison.OrdinalIgnoreCase) &&
                            (string)current.Arguments == "--open") return path;
                    }
                    finally { Marshal.FinalReleaseComObject(current); }
                    continue;
                }
                string pending = Path.Combine(desktop, "." + Guid.NewGuid().ToString("N") + ".lnk");
                try
                {
                    dynamic link = shell.CreateShortcut(pending);
                    try
                    {
                        link.TargetPath = exe;
                        link.Arguments = "--open";
                        link.WorkingDirectory = Path.GetDirectoryName(exe);
                        link.Description = "Open restaurant checkout";
                        link.IconLocation = exe + ",0";
                        link.Save();
                    }
                    finally { Marshal.FinalReleaseComObject(link); }
                    File.Move(pending, path);
                    return path;
                }
                finally { if (File.Exists(pending)) File.Delete(pending); }
            }
        }
        finally { Marshal.FinalReleaseComObject(shell); }
    }

    internal static void Launch(string kit, PrinterProfile profile)
    {
        string program = Path.Combine(kit, "program");
        var info = new ProcessStartInfo
        {
            FileName = Path.Combine(program, "electron.exe"),
            WorkingDirectory = program,
            Arguments = "\"" + Path.Combine(program, "resources", "app") + "\" \"--user-data-dir=" + profile.dataDirectory +
                "\" --pf700-routine-checkout --arra-fast-pay",
            UseShellExecute = false,
            RedirectStandardInput = true,
            CreateNoWindow = true
        };
        info.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
        info.EnvironmentVariables.Remove("NODE_OPTIONS");
        info.EnvironmentVariables.Remove("NODE_PATH");
        byte[] wire = profile.Encode();
        try
        {
            using (var child = Process.Start(info))
            {
                try
                {
                    using (Stream pipe = child.StandardInput.BaseStream) { pipe.Write(wire, 0, wire.Length); }
                }
                finally { Array.Clear(wire, 0, wire.Length); }
                profile.operatorPassword = null;
                child.WaitForExit();
            }
        }
        finally { Array.Clear(wire, 0, wire.Length); }
    }
}

internal sealed class PrinterSetup : Form
{
    private readonly string directory;
    private readonly TextBox serial = new TextBox { MaxLength = 11 };
    private readonly TextBox number = new TextBox { MaxLength = 1 };
    private readonly TextBox till = new TextBox { MaxLength = 5 };
    private readonly TextBox password = new TextBox { MaxLength = 6, UseSystemPasswordChar = true };
    private readonly CheckBox consent = new CheckBox { AutoSize = true,
        Text = "Enable live checkout from this desktop" };

    internal PrinterProfile Profile { get; private set; }

    internal PrinterSetup(string dataDirectory)
    {
        directory = dataDirectory;
        Text = "Arra POS desktop setup";
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        AutoScaleMode = AutoScaleMode.Font;
        Font = new Font("Segoe UI", 10);
        AutoSize = true;
        AutoSizeMode = AutoSizeMode.GrowAndShrink;
        var layout = new TableLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, Padding = new Padding(16), ColumnCount = 2 };
        Controls.Add(layout);
        AddWide(layout, new Label { Text = "Use the PF700 settings for this restaurant. Windows will protect them for this account.",
            AutoSize = true, MaximumSize = new Size(445, 0), Margin = new Padding(3, 3, 3, 12) });
        AddField(layout, "Printer serial number", serial);
        AddField(layout, "Printer operator number (1–8)", number);
        AddField(layout, "Till number", till);
        AddField(layout, "Printer operator password", password);
        AddWide(layout, new Label { Text = "Opening Arra from the desktop can send previously queued fiscal receipts that have never been attempted.",
            AutoSize = true, MaximumSize = new Size(445, 0), Margin = new Padding(3, 12, 3, 3) });
        consent.Margin = new Padding(3, 3, 3, 12);
        AddWide(layout, consent);
        var actions = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.RightToLeft, Dock = DockStyle.Fill };
        var save = new Button { Text = "Save and create shortcut", AutoSize = true };
        var cancel = new Button { Text = "Cancel", AutoSize = true, DialogResult = DialogResult.Cancel };
        save.Click += delegate
        {
            int op;
            Int32.TryParse(number.Text, NumberStyles.None, CultureInfo.InvariantCulture, out op);
            var profile = new PrinterProfile { dataDirectory = directory, expectedSerial = serial.Text.Trim(),
                operatorNumber = op, tillNumber = till.Text.Trim(), operatorPassword = password.Text, domesticProduct = false };
            if (!profile.ValidFor(directory) || !consent.Checked)
            {
                MessageBox.Show(this, "Enter the 11-character printer serial, operator number (1–8), till number (1–5 digits) and printer password (4–6 digits). Select the live checkout checkbox to continue.",
                    Text, MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            Profile = profile;
            DialogResult = DialogResult.OK;
        };
        actions.Controls.Add(save);
        actions.Controls.Add(cancel);
        AddWide(layout, actions);
        AcceptButton = save;
        CancelButton = cancel;
    }

    private static void AddWide(TableLayoutPanel layout, Control control)
    {
        layout.Controls.Add(control, 0, layout.RowCount++);
        layout.SetColumnSpan(control, 2);
    }

    private static void AddField(TableLayoutPanel layout, string label, TextBox input)
    {
        int row = layout.RowCount++;
        layout.Controls.Add(new Label { AutoSize = true, Anchor = AnchorStyles.Left, Text = label }, 0, row);
        input.Width = 215;
        layout.Controls.Add(input, 1, row);
    }
}
