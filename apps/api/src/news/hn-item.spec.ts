import {
  articleUrlFromHn,
  cleanStoryBlurb,
  isHnMetadata,
  stripHnMetadata,
} from './hn-item';

const HN_BLOB = `Article URL: https://github.com/Rohit-ATS/blast-radius
Comments URL: https://news.ycombinator.com/item?id=49397566
Points: 2
# Comments: 0`;

describe('hn-item', () => {
  it('detects HN score dumps', () => {
    expect(isHnMetadata(HN_BLOB)).toBe(true);
    expect(stripHnMetadata(HN_BLOB)).toBe('');
  });

  it('pulls the real article URL', () => {
    expect(articleUrlFromHn(HN_BLOB)).toBe(
      'https://github.com/Rohit-ATS/blast-radius',
    );
  });

  it('falls back to the title when there is no article text', () => {
    expect(cleanStoryBlurb('Blast Radius – npm blast radius', HN_BLOB)).toBe(
      'Blast Radius – npm blast radius.',
    );
  });
});
