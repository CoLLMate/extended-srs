// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { createCoreApi, type CoreApiV1 } from 'extended-srs-core/api';

/** All SRS interpretation uses the versioned, environment-independent core API. */
export const core: CoreApiV1 = createCoreApi();
