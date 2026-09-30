//! Skritch native core: capture, tray, hotkeys, clipboard, file IO and the ffmpeg-based video pipeline.
//! The command/event contract with the frontend is documented in `docs/IPC.md`.

mod capture;
mod clipboard;
mod error;
mod fileio;
mod hotkeys;
mod ipc;
mod launch;
#[cfg(target_os = "macos")]
mod macos;
mod menu;
mod tray;
mod video;
mod windows;

use tauri::{Emitter, Manager, RunEvent, WindowEvent};

pub fn run() {
    let app = tauri::Builder::default()
        // Must be registered first so a second launch exits before doing any work.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            launch::forward_second_instance(app, &argv, &cwd);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_drag::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(capture::CaptureState::default())
        .manage(windows::DocumentWindows::default())
        .manage(tray::TrayState::default())
        .manage(video::render::RenderJobs::default())
        .manage(launch::LaunchPaths::from_argv(&std::env::args().collect::<Vec<_>>()))
        .setup(|app| {
            if let Some(main) = app.get_webview_window(windows::MAIN) {
                windows::disable_transitions(&main);
            }
            menu::create(app.handle())?;
            tray::create(app.handle())?;
            hotkeys::register(app.handle());
            // Probe ffmpeg encoders in the background so the first export does not pay for it.
            std::thread::spawn(video::encoders);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Focused(true) = event {
                if windows::is_document(window.label()) {
                    *window.state::<windows::DocumentWindows>().0.lock().unwrap() = window.label().to_owned();
                    let _ = window.emit_to(window.label(), "menu://refresh", ());
                }
            }
            // Closing the main window keeps Skritch alive in the tray (Skitch behaviour).
            if let WindowEvent::CloseRequested { api, .. } = event {
                if windows::is_document(window.label()) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            menu::menu_set_enabled,
            menu::print_document,
            menu::page_setup,
            clipboard::clipboard_read_text,
            clipboard::clipboard_write_text,
            capture::capture_start,
            capture::capture_overlay_info,
            capture::capture_overlay_finish,
            capture::capture_last,
            capture::permissions::capture_permission_status,
            capture::permissions::open_screen_recording_settings,
            clipboard::clipboard_read_image,
            clipboard::clipboard_write_image,
            clipboard::clipboard_write_files,
            fileio::file_read,
            fileio::file_write,
            fileio::temp_write,
            fileio::image_convert,
            fileio::default_save_dir,
            fileio::allow_asset_path,
            launch::take_launch_paths,
            video::video_encoders,
            video::probe::video_probe,
            video::proxy::video_make_proxy,
            video::frame_png::video_thumbnail,
            video::frame_png::video_frame_png,
            video::render::video_render,
            video::render::video_cancel,
            windows::dropzone::tray_set_dropzone_visible,
            windows::show_main_window,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Skritch");

    app.run(|app, event| match event {
        // Keep running in the tray when the last window goes away; only an explicit Quit
        // (`app.exit(code)`) ends the process.
        RunEvent::ExitRequested { api, code: None, .. } => api.prevent_exit(),
        RunEvent::Exit => video::render::cancel_all(app.state::<video::render::RenderJobs>().inner()),
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => windows::show_main(app),
        // Finder "Open With", drops on the Dock icon, file associations: macOS delivers these as
        // Apple Events rather than argv.
        #[cfg(target_os = "macos")]
        RunEvent::Opened { urls } => {
            let paths: Vec<String> =
                urls.iter().filter_map(|u| u.to_file_path().ok()).map(|p| p.to_string_lossy().into_owned()).collect();
            launch::offer(app, paths);
        }
        _ => {}
    });
}
