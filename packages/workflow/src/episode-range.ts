/**
 * Conservative episode upper-bound hint from a resource TITLE.
 *
 * This is discovery only: callers must transfer and inspect real files before
 * marking anything obtained. Season 2+ requires an explicit matching season
 * marker; an unqualified “更新至6集” is safe only for season 1.
 */
export function episodeUpperBoundHint(title: string, targetSeason: number): number | null {
  const values: number[] = [];
  const explicitSeasons = new Set<number>();

  for (const match of title.matchAll(/\bS0*(\d+)E0*(\d+)\b/gi)) {
    const season = Number(match[1]);
    const episode = Number(match[2]);
    explicitSeasons.add(season);
    if (season === targetSeason && episode > 0) values.push(episode);
  }
  for (const match of title.matchAll(/第\s*(\d+)\s*季/g)) {
    explicitSeasons.add(Number(match[1]));
  }
  for (const match of title.matchAll(/\bSeason\s*0*(\d+)\b/gi)) {
    explicitSeasons.add(Number(match[1]));
  }
  for (const match of title.matchAll(/\bS0*(\d+)\b(?!E)/gi)) {
    explicitSeasons.add(Number(match[1]));
  }

  const hasMatchingSeason = explicitSeasons.has(targetSeason);
  const hasDifferentSeason = explicitSeasons.size > 0 && !hasMatchingSeason;
  // When multiple seasons appear in one title, an unqualified “更新至N集”
  // cannot be safely associated with either season. Explicit SxxEyy values
  // collected above remain usable; ambiguous ranges are ignored.
  const unqualifiedRangeAllowed =
    explicitSeasons.size <= 1 && (targetSeason === 1 || hasMatchingSeason);
  if (!hasDifferentSeason && unqualifiedRangeAllowed) {
    for (const pattern of [
      /(?:更新|更)\s*(?:至|到)\s*0*(\d+)\s*集/gi,
      /\b\d+\s*[-~～至]\s*0*(\d+)\s*集/gi,
      /全\s*0*(\d+)\s*集/gi,
    ]) {
      for (const match of title.matchAll(pattern)) {
        const episode = Number(match[1]);
        if (episode > 0) values.push(episode);
      }
    }
    // Bare E06 is a useful single-release hint, but never accept E2160p.
    for (const match of title.matchAll(/(?:^|[^A-Z0-9])E0*(\d+)(?!\d|p)/gi)) {
      const episode = Number(match[1]);
      if (episode > 0) values.push(episode);
    }
  }

  return values.length === 0 ? null : Math.max(...values);
}
