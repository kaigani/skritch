//! macOS-only integration (plan §2.1): the Screen Recording (TCC) permission, the cursor location in
//! the point space xcap uses, file URLs on the pasteboard ("Copy as file"), capture-overlay window
//! levels, and the menu-bar icon as a drop target.

mod status_item_drop;

use std::ffi::c_void;

use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2_app_kit::{
    NSPasteboard, NSPasteboardWriting, NSScreenSaverWindowLevel, NSWindow, NSWindowAnimationBehavior,
    NSWindowCollectionBehavior,
};
use objc2_foundation::{NSArray, NSString, NSURL};

pub use status_item_drop::install as install_status_item_drop;

#[repr(C)]
#[derive(Clone, Copy)]
struct CGPoint {
    x: f64,
    y: f64,
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
    fn CGEventCreate(source: *const c_void) -> *mut c_void;
    fn CGEventGetLocation(event: *const c_void) -> CGPoint;
    fn CGWindowListCreateDescriptionFromArray(window_ids: *const c_void) -> *const c_void;
    static kCGWindowIsOnscreen: *const c_void;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(cf: *const c_void);
    fn CFArrayCreate(
        allocator: *const c_void,
        values: *const *const c_void,
        count: isize,
        callbacks: *const c_void,
    ) -> *const c_void;
    fn CFArrayGetCount(array: *const c_void) -> isize;
    fn CFArrayGetValueAtIndex(array: *const c_void, index: isize) -> *const c_void;
    fn CFDictionaryGetValue(dict: *const c_void, key: *const c_void) -> *const c_void;
    fn CFBooleanGetValue(boolean: *const c_void) -> u8;
}

pub fn screen_capture_permission() -> &'static str {
    if unsafe { CGPreflightScreenCaptureAccess() } {
        "granted"
    } else {
        "denied"
    }
}

/// True if capturing may proceed. Without access, the first request shows the system prompt (once
/// per app); after that the user has to grant it in System Settings and relaunch Skritch.
pub fn ensure_screen_capture_access() -> bool {
    unsafe { CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess() }
}

/// Mouse location in global display points (origin at the top-left of the main display), the
/// coordinate space `xcap::Monitor::from_point` expects on macOS.
pub fn cursor_location() -> Option<(f64, f64)> {
    unsafe {
        let event = CGEventCreate(std::ptr::null());
        if event.is_null() {
            return None;
        }
        let p = CGEventGetLocation(event);
        CFRelease(event);
        Some((p.x, p.y))
    }
}

/// Whether the compositor still lists any of these windows (by WindowServer id) as on screen.
/// Asks WindowServer about just our own ids, which is far cheaper than enumerating every window.
/// `None` if the query itself failed.
pub fn any_onscreen(ids: &[u32]) -> Option<bool> {
    // The array holds the raw CGWindowID values themselves (no retain/release callbacks).
    let values: Vec<*const c_void> = ids.iter().map(|&id| id as usize as *const c_void).collect();
    // SAFETY: plain CoreFoundation/CoreGraphics calls on arrays we create and release here; the
    // dictionaries returned by `CFArrayGetValueAtIndex` are borrowed from `descriptions`.
    unsafe {
        let array = CFArrayCreate(std::ptr::null(), values.as_ptr(), values.len() as isize, std::ptr::null());
        if array.is_null() {
            return None;
        }
        let descriptions = CGWindowListCreateDescriptionFromArray(array);
        CFRelease(array);
        if descriptions.is_null() {
            return None;
        }
        let mut onscreen = false;
        for i in 0..CFArrayGetCount(descriptions) {
            let dict = CFArrayGetValueAtIndex(descriptions, i);
            let flag = CFDictionaryGetValue(dict, kCGWindowIsOnscreen);
            if !flag.is_null() && CFBooleanGetValue(flag) != 0 {
                onscreen = true;
            }
        }
        CFRelease(descriptions);
        Some(onscreen)
    }
}

/// Puts file URLs on the general pasteboard; pasting in Finder, Mail or chat apps copies the files.
pub fn write_file_urls(paths: &[String]) -> bool {
    let urls: Vec<Retained<ProtocolObject<dyn NSPasteboardWriting>>> =
        paths.iter().map(|p| ProtocolObject::from_retained(NSURL::fileURLWithPath(&NSString::from_str(p)))).collect();
    let pasteboard = NSPasteboard::generalPasteboard();
    pasteboard.clearContents();
    pasteboard.writeObjects(&NSArray::from_retained_slice(&urls))
}

/// Called on the main thread. Disable AppKit's automatic fade and hide synchronously, returning
/// the WindowServer id so the capture worker can verify that it is no longer onscreen.
pub fn hide_for_capture(window: &tauri::WebviewWindow) -> tauri::Result<Option<u32>> {
    let ptr = window.ns_window()?;
    // SAFETY: the caller runs on the main thread and Tauri owns this live NSWindow.
    let ns_window = unsafe { &*(ptr as *const NSWindow) };
    if !ns_window.isVisible() || ns_window.isMiniaturized() {
        return Ok(None);
    }
    ns_window.setAnimationBehavior(NSWindowAnimationBehavior::None);
    let id = ns_window.windowNumber() as u32;
    ns_window.orderOut(None);
    Ok(Some(id))
}

/// Capture overlays must sit above the menu bar and Dock and follow the user into full-screen
/// Spaces; Tauri's always-on-top level (floating) is below the menu bar.
pub fn raise_overlay(window: &tauri::WebviewWindow) {
    let Ok(ptr) = window.ns_window() else { return };
    // SAFETY: Tauri returns the live NSWindow backing this webview window; we are on the main thread
    // (overlays are configured from `run_on_main_thread`).
    let ns_window = unsafe { &*(ptr as *const NSWindow) };
    // Overlays are kept alive and hidden/shown for every capture; neither may fade.
    ns_window.setAnimationBehavior(NSWindowAnimationBehavior::None);
    ns_window.setLevel(NSScreenSaverWindowLevel);
    ns_window.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces | NSWindowCollectionBehavior::FullScreenAuxiliary,
    );
}
