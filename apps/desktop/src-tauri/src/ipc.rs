//! Helpers for raw-bytes commands (docs/IPC.md "Binary payloads"): JS sends a `Uint8Array` body plus
//! `encodeURIComponent`-encoded `x-…` headers.

use tauri::ipc::{InvokeBody, Request};

use crate::error::{AppError, AppResult};

/// The raw request body. JSON bodies are rejected: callers must pass a `Uint8Array`.
pub fn raw_body<'a>(request: &'a Request<'_>) -> AppResult<&'a [u8]> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes),
        InvokeBody::Json(_) => Err(AppError::invalid("expected a raw (Uint8Array) request body")),
    }
}

/// A percent-decoded header value, or `None` if the header is absent.
pub fn header(request: &Request<'_>, name: &str) -> AppResult<Option<String>> {
    let Some(value) = request.headers().get(name) else { return Ok(None) };
    let value = value.to_str().map_err(|_| AppError::invalid(format!("header {name} is not ASCII")))?;
    decode_header_value(value).map(Some)
}

/// Like [`header`] but the header must be present.
pub fn required_header(request: &Request<'_>, name: &str) -> AppResult<String> {
    header(request, name)?.ok_or_else(|| AppError::invalid(format!("missing header {name}")))
}

/// Reverses JS `encodeURIComponent`.
pub fn decode_header_value(value: &str) -> AppResult<String> {
    percent_encoding::percent_decode_str(value)
        .decode_utf8()
        .map(|s| s.into_owned())
        .map_err(|_| AppError::invalid("header is not valid percent-encoded UTF-8"))
}

#[cfg(test)]
mod tests {
    use super::decode_header_value;

    #[test]
    fn decodes_encode_uri_component_output() {
        // encodeURIComponent('C:\\Users\\Zoë\\My Pictures\\shot #1.png')
        let encoded = "C%3A%5CUsers%5CZo%C3%AB%5CMy%20Pictures%5Cshot%20%231.png";
        assert_eq!(decode_header_value(encoded).unwrap(), "C:\\Users\\Zoë\\My Pictures\\shot #1.png");
    }

    #[test]
    fn passes_plain_values_through() {
        assert_eq!(decode_header_value("0.9").unwrap(), "0.9");
        assert_eq!(decode_header_value("/tmp/a-b_c.png").unwrap(), "/tmp/a-b_c.png");
    }

    #[test]
    fn rejects_invalid_utf8() {
        assert!(decode_header_value("%FF%FE").is_err());
    }
}
