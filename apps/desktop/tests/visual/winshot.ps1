# Screenshots the Skritch main window (desktop build) for visual review.
# Usage: powershell -File winshot.ps1 -Out <png> [-Hotkey 7] [-Focus]
param([string]$Out, [int]$Hotkey = 0, [switch]$Focus, [string]$Keys = '')

Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class W {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int s);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint f);
}
'@
[W]::SetProcessDPIAware() | Out-Null

if ($Hotkey -gt 0) {
  # Ctrl+Shift+<digit> global snap hotkey
  $d = [byte](0x30 + $Hotkey)
  [W]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero); [W]::keybd_event(0x10, 0, 0, [UIntPtr]::Zero)
  [W]::keybd_event($d, 0, 0, [UIntPtr]::Zero); [W]::keybd_event($d, 0, 2, [UIntPtr]::Zero)
  [W]::keybd_event(0x10, 0, 2, [UIntPtr]::Zero); [W]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 1500
}

$p = Get-Process skritch -ErrorAction Stop | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
$h = $p.MainWindowHandle
if ($Focus -or $Keys) {
  # a synthetic Alt press lets a background process take the foreground
  [W]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [W]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
  [W]::SetForegroundWindow($h) | Out-Null; Start-Sleep -Milliseconds 400
}
if ($Keys) {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.SendKeys]::SendWait($Keys); Start-Sleep -Milliseconds 1500
}
$r = New-Object W+RECT
[W]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.R - $r.L; $hh = $r.B - $r.T
$bmp = New-Object System.Drawing.Bitmap $w, $hh
$g = [System.Drawing.Graphics]::FromImage($bmp)
# PW_RENDERFULLCONTENT (2) captures DirectComposition content (WebView2) even when occluded
$hdc = $g.GetHdc(); [W]::PrintWindow($h, $hdc, 2) | Out-Null; $g.ReleaseHdc($hdc)
# crop the invisible resize border using the DWM frame bounds
$f = New-Object W+RECT
[W]::DwmGetWindowAttribute($h, 9, [ref]$f, 16) | Out-Null
$crop = New-Object System.Drawing.Rectangle ($f.L - $r.L), ($f.T - $r.T), ($f.R - $f.L), ($f.B - $f.T)
$bmp.Clone($crop, $bmp.PixelFormat).Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$w = $crop.Width; $hh = $crop.Height
"saved $Out ($w x $hh) title='$($p.MainWindowTitle)'"
