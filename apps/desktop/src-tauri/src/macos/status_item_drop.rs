//! The menu-bar icon as a drop target (plan §2.1, §6.9).
//!
//! A transparent `NSView` is laid over the status item's button and registered for file URLs. It
//! returns nil from `hitTest:` so clicks still reach tray-icon's own view underneath; AppKit picks
//! drag destinations by registered pasteboard types, not by `hitTest:`. Dropped paths are forwarded
//! to the main window as `files://dropped { source: 'tray' }`, where images go through the arrival
//! dialog and videos append to (or open) a video project.

use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{define_class, msg_send, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSAutoresizingMaskOptions, NSDragOperation, NSDraggingInfo, NSPasteboardTypeFileURL, NSStatusItem, NSView,
};
use objc2_foundation::{NSArray, NSPoint, NSURL};
use serde_json::json;
use tauri::{AppHandle, Emitter};

use crate::windows::{self, MAIN};

pub struct Ivars {
    app: AppHandle,
}

define_class!(
    #[unsafe(super(NSView))]
    #[thread_kind = MainThreadOnly]
    #[name = "SkritchStatusItemDropView"]
    #[ivars = Ivars]
    struct DropView;

    impl DropView {
        #[unsafe(method(hitTest:))]
        fn hit_test(&self, _point: NSPoint) -> *mut NSView {
            std::ptr::null_mut()
        }

        #[unsafe(method(draggingEntered:))]
        fn dragging_entered(&self, sender: &ProtocolObject<dyn NSDraggingInfo>) -> NSDragOperation {
            if dropped_paths(sender).is_empty() {
                NSDragOperation::None
            } else {
                NSDragOperation::Copy
            }
        }

        #[unsafe(method(prepareForDragOperation:))]
        fn prepare_for_drag_operation(&self, _sender: &ProtocolObject<dyn NSDraggingInfo>) -> bool {
            true
        }

        #[unsafe(method(performDragOperation:))]
        fn perform_drag_operation(&self, sender: &ProtocolObject<dyn NSDraggingInfo>) -> bool {
            let paths = dropped_paths(sender);
            let accepted = !paths.is_empty();
            if accepted {
                let app = &self.ivars().app;
                windows::show_main(app);
                let _ = app.emit_to(MAIN, "files://dropped", json!({ "paths": paths, "source": "tray" }));
            }
            accepted
        }
    }
);

/// POSIX paths of the file URLs being dragged (file reference URLs are resolved to paths).
fn dropped_paths(info: &ProtocolObject<dyn NSDraggingInfo>) -> Vec<String> {
    let Some(items) = info.draggingPasteboard().pasteboardItems() else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            let string = item.stringForType(unsafe { NSPasteboardTypeFileURL })?;
            let url = NSURL::URLWithString(&string)?;
            let url = url.filePathURL().unwrap_or(url);
            Some(url.path()?.to_string())
        })
        .collect()
}

/// Adds the drop view to the status item's button. Must run on the main thread.
pub fn install(app: &AppHandle, status_item: &NSStatusItem) {
    let Some(mtm) = MainThreadMarker::new() else {
        eprintln!("[skritch] status item drop target: not on the main thread");
        return;
    };
    let Some(button) = status_item.button(mtm) else { return };
    let this = mtm.alloc::<DropView>().set_ivars(Ivars { app: app.clone() });
    let view: Retained<DropView> = unsafe { msg_send![super(this), initWithFrame: button.bounds()] };
    view.setAutoresizingMask(
        NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable,
    );
    view.registerForDraggedTypes(&NSArray::from_slice(&[unsafe { NSPasteboardTypeFileURL }]));
    button.addSubview(&view);
}
