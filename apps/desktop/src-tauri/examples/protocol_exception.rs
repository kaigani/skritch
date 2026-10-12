//! Release-profile regression check for the macOS WebKit cancellation crash.
//! Run `cargo run --locked --release --example protocol_exception` on macOS.
//! `cargo test --release` uses unwinding even with panic = "abort", so this must
//! be an executable example to exercise the actual shipping panic strategy.

#[cfg(target_os = "macos")]
fn main() {
    use objc2::{exception, rc::autoreleasepool};
    use objc2_foundation::{NSException, NSString};

    // Tauri's asynchronous protocol responders run on worker threads. WebKit
    // raises NSInternalInconsistencyException if a response reaches a stopped
    // task; Wry uses the same catch wrapper to discard that response.
    std::thread::spawn(|| {
        autoreleasepool(|_| {
            for _ in 0..100 {
                let result = exception::catch(|| {
                    // SAFETY: no userInfo dictionary or generic payload is supplied.
                    let ex = unsafe {
                        NSException::exceptionWithName_reason_userInfo(
                            &NSString::from_str("NSInternalInconsistencyException"),
                            Some(&NSString::from_str("This task has already been stopped")),
                            None,
                        )
                    };
                    ex.raise();
                });
                let ex = result.expect_err("the simulated stopped task must raise an exception");
                assert!(ex.is_some(), "the native exception must be retained by the catch wrapper");
            }
        });
    })
    .join()
    .expect("the protocol response worker must survive cancelled tasks");
    println!(
        "Caught 100 native cancellation exceptions without aborting (panic={}).",
        if cfg!(panic = "unwind") { "unwind" } else { "abort" }
    );
}

#[cfg(not(target_os = "macos"))]
fn main() {
    println!("The native protocol exception check requires macOS.");
}
