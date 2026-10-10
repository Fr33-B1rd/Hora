// Syntax guard, not an intent router. A venue name alone cannot fix a time.
export const hasTimeAnchor=text=>/(?:\b\d{1,2}:\d{2}\b|\b\d{1,2}\s*(?:a\.?m\.?|p\.?m\.?|o[’']clock)\b|\b(?:morning|noon|midday|afternoon|evening|night|midnight|breakfast|lunch|lunchtime|dinner|sunset|dawn)\b)/iu.test(String(text||''));
export const hasOrderAnchor=text=>/\b(?:first|firstly|then|before|after|afterwards?|later|finally|lastly|last|followed by|prior to|once|start(?:ing)? with|end(?:ing)? with|in that order)\b/iu.test(String(text||''));
