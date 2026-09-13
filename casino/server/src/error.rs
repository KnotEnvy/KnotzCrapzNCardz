//! One error type, one JSON shape.
//!
//! Every handler returns `Result<T, FloorError>`, and every failure the client
//! sees is `{ "error": "code", "message": "..." }`. The code is stable and
//! machine-readable; the message is for a person. Nothing ever leaks a SQL
//! string or a panic message to a browser — a database failure is logged in
//! full and reported as `internal`.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum FloorError {
    #[error("{0}")]
    BadRequest(String),

    #[error("not signed in")]
    Unauthorized,

    #[error("{0}")]
    Forbidden(String),

    #[error("{0} not found")]
    NotFound(&'static str),

    #[error("{0}")]
    Conflict(String),

    /// The one the player actually cares about: the wallet cannot cover it.
    #[error("that is more than the wallet holds")]
    InsufficientFunds { balance: i64, needed: i64 },

    #[error(transparent)]
    Db(#[from] sqlx::Error),

    #[error("{0}")]
    Internal(String),
}

impl FloorError {
    fn code(&self) -> &'static str {
        match self {
            Self::BadRequest(_) => "bad_request",
            Self::Unauthorized => "unauthorized",
            Self::Forbidden(_) => "forbidden",
            Self::NotFound(_) => "not_found",
            Self::Conflict(_) => "conflict",
            Self::InsufficientFunds { .. } => "insufficient_funds",
            Self::Db(_) | Self::Internal(_) => "internal",
        }
    }

    fn status(&self) -> StatusCode {
        match self {
            Self::BadRequest(_) => StatusCode::BAD_REQUEST,
            Self::Unauthorized => StatusCode::UNAUTHORIZED,
            Self::Forbidden(_) => StatusCode::FORBIDDEN,
            Self::NotFound(_) => StatusCode::NOT_FOUND,
            Self::Conflict(_) => StatusCode::CONFLICT,
            // 402 is the one status code that means exactly this, and a floor
            // is the one kind of service entitled to use it literally.
            Self::InsufficientFunds { .. } => StatusCode::PAYMENT_REQUIRED,
            Self::Db(_) | Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl IntoResponse for FloorError {
    fn into_response(self) -> Response {
        let status = self.status();
        let code = self.code();

        // The detail a player can act on rides along; everything else stays in
        // the log.
        let mut body = json!({ "error": code, "message": self.to_string() });
        if let Self::InsufficientFunds { balance, needed } = &self {
            body["balance"] = json!(balance);
            body["needed"] = json!(needed);
        }

        match &self {
            Self::Db(err) => tracing::error!(%err, "database error"),
            Self::Internal(msg) => tracing::error!(%msg, "internal error"),
            _ => {}
        }

        if matches!(self, Self::Db(_) | Self::Internal(_)) {
            body["message"] = json!("the floor is having a moment; try that again");
        }

        (status, Json(body)).into_response()
    }
}

pub type FloorResult<T> = Result<T, FloorError>;
