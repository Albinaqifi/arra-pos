using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;

// Only the files in the verified RC4 release can receive the launch profile.
// Program data, operator settings and the desktop shortcut live outside program/.
internal static class ReleaseFiles
{
    internal static void Verify(string installDirectory)
    {
        string root = Path.GetFullPath(installDirectory);
        Dictionary<string, string> expected = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        using (Stream manifest = Assembly.GetExecutingAssembly().GetManifestResourceStream("ArraPOS.RC4.sha256"))
        using (StreamReader reader = new StreamReader(manifest))
        {
            string line;
            while ((line = reader.ReadLine()) != null)
                expected.Add(line.Substring(66).Replace('/', Path.DirectorySeparatorChar), line.Substring(0, 64));
        }

        using (SHA256 sha = new SHA256Cng())
        {
            VerifyFile(root, "Open-Arra-Pay.cmd", sha, expected);
            Stack<string> folders = new Stack<string>();
            folders.Push("program");
            while (folders.Count > 0)
            {
                string folder = folders.Pop();
                string path = Path.Combine(root, folder);
                RejectRedirect(path);
                foreach (string child in Directory.EnumerateFileSystemEntries(path))
                {
                    string relative = Path.Combine(folder, Path.GetFileName(child));
                    if ((File.GetAttributes(child) & FileAttributes.Directory) != 0)
                        folders.Push(relative);
                    else
                        VerifyFile(root, relative, sha, expected);
                }
            }
        }
        if (expected.Count != 0)
            throw new InvalidDataException("Files from the Arra POS RC4 program folder are missing.");
    }

    private static void VerifyFile(string root, string relative, SHA256 sha, Dictionary<string, string> expected)
    {
        string digest;
        if (!expected.TryGetValue(relative, out digest))
            throw new InvalidDataException("The program folder differs from the Arra POS RC4 release.");
        string path = Path.Combine(root, relative);
        RejectRedirect(path);
        using (FileStream file = File.OpenRead(path))
        {
            string actual = BitConverter.ToString(sha.ComputeHash(file)).Replace("-", "");
            if (!String.Equals(actual, digest, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("The Arra POS RC4 program files could not be verified.");
        }
        expected.Remove(relative);
    }

    private static void RejectRedirect(string path)
    {
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidDataException("Use the extracted Arra POS RC4 program files.");
    }
}
