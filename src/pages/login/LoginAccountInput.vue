<template>
  <el-input
    ref="input"
    :model-value="modelValue"
    aria-label="账号"
    name="username"
    autocomplete="username"
    placeholder="请输入账号"
    :prefix-icon="User"
    :maxlength="64"
    :disabled="disabled"
    clearable
    @update:model-value="updateAccount"
  >
    <template v-if="accounts.length" #suffix>
      <el-dropdown
        trigger="click"
        placement="bottom-end"
        popper-class="login-account-popper"
        :show-arrow="false"
        :offset="8"
        :disabled="disabled"
        @command="selectAccount"
        @visible-change="setExpanded"
      >
        <button
          type="button"
          class="icon-button account-dropdown-button"
          aria-label="选择历史账号"
          title="选择历史账号"
          :disabled="disabled"
          :class="{ 'is-expanded': expanded }"
          :aria-expanded="expanded"
        >
          <el-icon :size="14"><ArrowDown /></el-icon>
        </button>
        <template #dropdown>
          <el-dropdown-menu class="login-account-menu">
            <el-dropdown-item
              v-for="item in accounts"
              :key="item.id"
              :command="item.id"
              :class="{ 'is-current': item.account === modelValue }"
              ><span class="login-account-avatar" aria-hidden="true">
                <AvatarImage :src="item.avatar" /> </span
              ><span class="login-account-name" :title="item.account">{{
                item.account
              }}</span>
              <el-icon
                v-if="item.account === modelValue"
                class="login-account-check"
                :size="15"
                aria-label="当前账号"
                ><Check
              /></el-icon>
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </template>
  </el-input>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import {
  ElInput,
  ElIcon,
  ElDropdown,
  ElDropdownMenu,
  ElDropdownItem,
} from 'element-plus';
import 'element-plus/es/components/input/style/css';
import 'element-plus/es/components/icon/style/css';
import 'element-plus/es/components/dropdown/style/css';
import 'element-plus/es/components/dropdown-menu/style/css';
import 'element-plus/es/components/dropdown-item/style/css';
import type { InputInstance } from 'element-plus';
import { User, ArrowDown, Check } from '@element-plus/icons-vue';
import type { SavedLoginAccount } from '../../services/auth/auth';
import AvatarImage from '../../components/avatar/AvatarImage.vue';

defineProps<{
  modelValue: string;
  accounts: SavedLoginAccount[];
  disabled: boolean;
}>();
const emit = defineEmits<{
  'update:modelValue': [value: string];
  select: [id: string];
}>();
const input = ref<InputInstance>();
const expanded = ref(false);

/** 下拉展开时同步箭头状态。 */
const setExpanded = (value: boolean): void => {
  expanded.value = value;
};

/** 切换到密码表单后恢复账号输入焦点。 */
const focus = (): void => {
  input.value?.focus();
};

defineExpose({ focus });

/** 编辑账号只更新表单，不将输入内容当作已授权身份。 */
const updateAccount = (value: string): void => {
  emit('update:modelValue', value);
};

/** 下拉项只携带历史账号标识，不再提供新账号菜单项。 */
const selectAccount = (id: string): void => {
  emit('select', id);
};
</script>
