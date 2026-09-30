fn main() {
    // Exposed so the ffmpeg lookup can find Tauri-style sidecars named `ffmpeg-<target-triple>[.exe]`.
    println!(
        "cargo:rustc-env=SKRITCH_TARGET_TRIPLE={}",
        std::env::var("TARGET").expect("cargo sets TARGET for build scripts")
    );
    tauri_build::build()
}
