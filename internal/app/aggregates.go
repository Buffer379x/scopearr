package app

import "context"

// Cached aggregates are immutable snapshots and are invalidated after a successful commit.
func (s *Store) FacetsContext(ctx context.Context, service string) (map[string][]string, error) {
	if !serviceOK(service) {
		return s.facets(ctx, service)
	}
	index := 0
	if serviceKind(service) == "sonarr" {
		index = 1
	}
	s.facetLoad[index].Lock()
	defer s.facetLoad[index].Unlock()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.cacheMu.Lock()
	result, ok := s.facetCache[service]
	generation := s.cacheGeneration
	s.cacheMu.Unlock()
	if ok {
		return cloneFacets(result), nil
	}
	result, err := s.facets(ctx, service)
	if err != nil {
		return nil, err
	}
	s.cacheMu.Lock()
	if generation == s.cacheGeneration {
		s.facetCache[service] = result
	}
	s.cacheMu.Unlock()
	return cloneFacets(result), nil
}
func cloneFacets(in map[string][]string) map[string][]string {
	out := map[string][]string{}
	for key, values := range in {
		out[key] = append([]string{}, values...)
	}
	return out
}
func (s *Store) StatisticsContext(ctx context.Context) (Statistics, error) {
	s.statisticsLoad.Lock()
	defer s.statisticsLoad.Unlock()
	if err := ctx.Err(); err != nil {
		return Statistics{}, err
	}
	s.cacheMu.Lock()
	cached := s.statisticsCache
	generation := s.cacheGeneration
	s.cacheMu.Unlock()
	if cached != nil {
		return cloneStatistics(*cached), nil
	}
	result, err := s.statistics(ctx)
	if err != nil {
		return result, err
	}
	s.cacheMu.Lock()
	if generation == s.cacheGeneration {
		s.statisticsCache = &result
	}
	s.cacheMu.Unlock()
	return cloneStatistics(result), nil
}
func cloneStatistics(in Statistics) Statistics {
	out := in
	out.FileTotals = map[string]int{}
	for key, value := range in.FileTotals {
		out.FileTotals[key] = value
	}
	out.LanguageTotals = map[string]int{}
	for key, value := range in.LanguageTotals {
		out.LanguageTotals[key] = value
	}
	out.Emby = map[string]int{}
	for key, value := range in.Emby {
		out.Emby[key] = value
	}
	out.Distributions = map[string]map[string][]StatisticBucket{}
	for service, traits := range in.Distributions {
		out.Distributions[service] = map[string][]StatisticBucket{}
		for key, buckets := range traits {
			out.Distributions[service][key] = append([]StatisticBucket{}, buckets...)
		}
	}
	return out
}

// Custom tags do not change Dashboard's media/audio aggregates.
func (s *Store) invalidateCustomFacets() {
	s.cacheMu.Lock()
	defer s.cacheMu.Unlock()
	s.facetCache = map[string]map[string][]string{}
	s.catalogCache = nil
	s.cacheGeneration++
}
