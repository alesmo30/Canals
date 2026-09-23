import { useState } from 'react';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import { Box, IconButton, Tooltip } from '@mui/material';

import { brand, fonts } from '../theme';

interface JsonBlockProps {
  value: unknown;
  maxHeight?: number | string;
  /** light = on a white card (request preview); dark = response body. */
  tone?: 'dark' | 'light';
}

/**
 * Minimal JSON syntax colouring — keys, strings, numbers, literals.
 * Safe for dangerouslySetInnerHTML: the text is HTML-escaped first, and
 * the only markup added is spans with colours from the fixed table above.
 */
function highlight(json: string, tone: 'dark' | 'light'): string {
  const colours =
    tone === 'dark'
      ? { key: '#9CC0FF', string: '#8FE3B9', number: '#FFC58A', literal: '#C5A3FF' }
      : { key: brand.navy700, string: brand.green, number: brand.amber, literal: brand.purple };
  const escaped = json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.replace(
    /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    (match) => {
      let colour = colours.number;
      if (match.startsWith('"')) {
        colour = match.trimEnd().endsWith(':') ? colours.key : colours.string;
      } else if (/true|false|null/.test(match)) {
        colour = colours.literal;
      }
      return `<span style="color:${colour}">${match}</span>`;
    },
  );
}

export function JsonBlock({
  value,
  maxHeight = 480,
  tone = 'dark',
}: JsonBlockProps) {
  const [copied, setCopied] = useState(false);
  const text =
    typeof value === 'string' ? value : JSON.stringify(value, null, 2);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard can be blocked; copying is a convenience.
    }
  };

  return (
    <Box sx={{ position: 'relative' }}>
      <Tooltip title={copied ? 'Copied' : 'Copy'}>
        <IconButton
          size="small"
          onClick={copy}
          aria-label="Copy JSON"
          sx={{
            position: 'absolute',
            top: 6,
            right: 6,
            color: tone === 'dark' ? 'rgba(255,255,255,0.7)' : 'text.secondary',
          }}
        >
          {copied ? (
            <CheckIcon fontSize="small" />
          ) : (
            <ContentCopyIcon fontSize="small" />
          )}
        </IconButton>
      </Tooltip>
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 2,
          pr: 5,
          borderRadius: 2,
          overflow: 'auto',
          maxHeight,
          fontFamily: fonts.mono,
          fontSize: 12.5,
          lineHeight: 1.6,
          backgroundColor: tone === 'dark' ? 'navy.main' : 'surface.subtle',
          color: tone === 'dark' ? '#E6ECFF' : 'text.primary',
          border: tone === 'light' ? 1 : 0,
          borderColor: 'divider',
        }}
        dangerouslySetInnerHTML={{ __html: highlight(text, tone) }}
      />
    </Box>
  );
}
