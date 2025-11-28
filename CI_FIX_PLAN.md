# GitHub Actions CI Fix Plan

## Repository Analysis
- **Repository**: `JoeyCacciatore3/-brains.git`
- **Last Commit**: `77913a9` - "Fix CI workflow: add proper dependencies, env vars, and artifact uploads"
- **CI Workflow**: `.github/workflows/ci.yml`

## Issues Identified

### 🔴 Critical Issues

#### 1. **Vitest Watch Mode Hanging CI** (Line 73)
- **Problem**: `npm test` runs `vitest` without `--run` flag, causing it to run in watch mode
- **Impact**: CI job will hang indefinitely waiting for file changes
- **Location**: `.github/workflows/ci.yml:73`
- **Current Code**: `run: npm test`
- **Fix Required**: Add `--run` flag to exit after tests complete

#### 2. **Missing CI Environment Variable** (Line 72-75)
- **Problem**: Unit tests job doesn't explicitly set `CI=true` environment variable
- **Impact**: Vitest may not detect CI environment properly (though it should auto-detect)
- **Location**: `.github/workflows/ci.yml:72-75`
- **Current Code**: Only has `NODE_ENV: test`
- **Fix Required**: Add `CI: true` to env vars

### ⚠️ Potential Issues

#### 3. **.nvmrc File Format** (Line 1-3)
- **Problem**: `.nvmrc` file contains comments which may cause issues with `node-version-file`
- **Impact**: `actions/setup-node@v4` might fail to parse the version correctly
- **Location**: `.nvmrc:1-3`
- **Current Content**:
  ```
  # Minimum required: 20.9.0 (as specified in package.json engines)
  # Using 20.18.0 LTS for better compatibility and security updates
  20.18.0
  ```
- **Fix Required**: Remove comments, keep only version number

#### 4. **Coverage Artifact Upload** (Line 77-84)
- **Problem**: Coverage directory may not exist if tests don't generate coverage by default
- **Impact**: Artifact upload step might fail (though `if-no-files-found: ignore` should handle this)
- **Location**: `.github/workflows/ci.yml:77-84`
- **Status**: Already has `if-no-files-found: ignore` - this is fine

### ✅ Verified Working

- Job dependencies are correct
- Environment variables for build and E2E are properly set
- Playwright configuration is correct
- Security audit is properly configured
- Artifact uploads have proper error handling

## Fix Plan

### Step 1: Fix Vitest Watch Mode Issue
**File**: `.github/workflows/ci.yml`
**Change**: Line 73
```yaml
# BEFORE:
- name: Run unit and integration tests
  run: npm test
  env:
    NODE_ENV: test

# AFTER:
- name: Run unit and integration tests
  run: npm test -- --run
  env:
    NODE_ENV: test
    CI: true
```

**Explanation**:
- `-- --run` passes `--run` flag to vitest, making it exit after running tests
- `CI: true` explicitly sets CI environment (redundant but good practice)

### Step 2: Fix .nvmrc File Format
**File**: `.nvmrc`
**Change**: Remove comments, keep only version
```bash
# BEFORE:
# Minimum required: 20.9.0 (as specified in package.json engines)
# Using 20.18.0 LTS for better compatibility and security updates
20.18.0

# AFTER:
20.18.0
```

**Explanation**:
- `node-version-file` expects only the version number
- Comments can cause parsing issues

### Step 3: Verify All Changes
After making changes, verify:
1. YAML syntax is valid
2. All environment variables are properly set
3. Job dependencies are correct
4. No other issues in the workflow

## Implementation Order

1. ✅ Fix `.nvmrc` file (remove comments)
2. ✅ Fix CI workflow unit-tests job (add `--run` flag and `CI: true`)
3. ✅ Verify YAML syntax
4. ✅ Test locally if possible
5. ✅ Commit and push changes

## Expected Outcomes

After fixes:
- ✅ Unit tests will run and exit properly (no hanging)
- ✅ Node.js version will be correctly parsed from `.nvmrc`
- ✅ CI environment will be properly detected
- ✅ All jobs should complete successfully

## Testing Strategy

1. **Local Testing** (if possible):
   - Run `npm test -- --run` locally to verify it works
   - Check that `.nvmrc` format is correct

2. **CI Testing**:
   - Push changes to a test branch
   - Monitor GitHub Actions workflow run
   - Verify all jobs complete successfully
   - Check that unit tests don't hang

## Risk Assessment

- **Low Risk**: All changes are straightforward and well-documented
- **Rollback**: Easy to revert if issues occur
- **Impact**: Fixes critical CI hanging issue

## Additional Recommendations

1. Consider adding a `test:ci` script to `package.json`:
   ```json
   "test:ci": "vitest --run"
   ```
   Then use `npm run test:ci` in CI for clarity

2. Consider adding workflow status badge to README after fixes are verified

3. Monitor first few CI runs after fixes to ensure stability
