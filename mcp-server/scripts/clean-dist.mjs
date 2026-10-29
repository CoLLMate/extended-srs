// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { rmSync } from 'node:fs';
// Remove only this package's generated output, including files moved between source folders.
rmSync(new URL('../dist/', import.meta.url), { recursive: true, force: true });
