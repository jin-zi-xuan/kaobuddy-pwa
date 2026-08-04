use regex::Regex;

pub fn embed_url(input: &str) -> Option<String> {
    let input = input.trim();
    let bvid = Regex::new(r"(?i)(BV[0-9A-Za-z]{10})")
        .ok()?
        .captures(input)
        .and_then(|capture| capture.get(1))
        .map(|value| value.as_str().to_string());
    if let Some(bvid) = bvid {
        return Some(format!(
            "https://player.bilibili.com/player.html?bvid={bvid}&page=1&high_quality=1&danmaku=0"
        ));
    }

    let aid = Regex::new(r"(?i)(?:video/)?av(\d+)")
        .ok()?
        .captures(input)
        .and_then(|capture| capture.get(1))
        .map(|value| value.as_str().to_string());
    aid.map(|aid| {
        format!("https://player.bilibili.com/player.html?aid={aid}&page=1&high_quality=1&danmaku=0")
    })
}

#[cfg(test)]
mod tests {
    use super::embed_url;

    #[test]
    fn parses_bv_links() {
        let url = embed_url("https://www.bilibili.com/video/BV1xx411c7mD").unwrap();
        assert!(url.contains("bvid=BV1xx411c7mD"));
    }

    #[test]
    fn rejects_non_bilibili_identifiers() {
        assert!(embed_url("https://example.com/watch/123").is_none());
    }
}
