<template>
  <div class="page-stack">
    <el-row :gutter="20">
      <el-col :span="18">
        <el-card header="企业客户基础档案">
          <el-form :model="form" label-width="120px">
            <el-row :gutter="16">
              <el-col :span="12">
                <el-form-item label="客户全称">
                  <el-input v-model="form.customerName" placeholder="请输入企业客户名称" />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="客户简称">
                  <el-input v-model="form.shortName" placeholder="请输入简称" />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="客户编码">
                  <el-input v-model="form.customerCode" placeholder="例如：CUST-202603-001" />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="所属行业">
                  <el-select v-model="form.industry" placeholder="请选择行业">
                    <el-option label="零售连锁" value="retail" />
                    <el-option label="医药健康" value="healthcare" />
                    <el-option label="制造业" value="manufacturing" />
                    <el-option label="互联网服务" value="internet" />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="客户等级">
                  <el-radio-group v-model="form.level">
                    <el-radio value="a">A 级</el-radio>
                    <el-radio value="b">B 级</el-radio>
                    <el-radio value="c">C 级</el-radio>
                  </el-radio-group>
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="归属区域">
                  <el-cascader v-model="form.region" :options="regionOptions" placeholder="请选择区域" />
                </el-form-item>
              </el-col>
            </el-row>
          </el-form>
        </el-card>

        <el-collapse v-model="activePanels" style="margin-top: 20px">
          <el-collapse-item title="结算与开票信息" name="settlement">
            <el-form :model="form" label-width="120px">
              <el-row :gutter="16">
                <el-col :span="12">
                  <el-form-item label="结算主体">
                    <el-input v-model="form.settlementSubject" placeholder="请输入结算主体" />
                  </el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="默认账期">
                    <el-select v-model="form.paymentTerm" placeholder="请选择账期">
                      <el-option label="现结" value="cash" />
                      <el-option label="月结 30 天" value="30" />
                      <el-option label="月结 45 天" value="45" />
                      <el-option label="月结 60 天" value="60" />
                    </el-select>
                  </el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="开票抬头">
                    <el-input v-model="form.invoiceTitle" placeholder="请输入开票抬头" />
                  </el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="纳税人识别号">
                    <el-input v-model="form.invoiceTaxNo" placeholder="请输入纳税人识别号" />
                  </el-form-item>
                </el-col>
                <el-col :span="24">
                  <el-form-item label="注册地址">
                    <el-input v-model="form.invoiceAddress" placeholder="请输入注册地址" />
                  </el-form-item>
                </el-col>
              </el-row>
            </el-form>
          </el-collapse-item>

          <el-collapse-item title="联系人信息" name="contacts">
            <el-table :data="contacts" border style="width: 100%">
              <el-table-column label="姓名" min-width="140">
                <template #default="{ row }">
                  <el-input v-model="row.name" placeholder="联系人姓名" />
                </template>
              </el-table-column>
              <el-table-column label="角色" min-width="160">
                <template #default="{ row }">
                  <el-select v-model="row.role" placeholder="请选择角色">
                    <el-option label="商务负责人" value="biz" />
                    <el-option label="财务负责人" value="finance" />
                    <el-option label="收货联系人" value="receiver" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="手机号" min-width="160">
                <template #default="{ row }">
                  <el-input v-model="row.mobile" placeholder="手机号" />
                </template>
              </el-table-column>
              <el-table-column label="邮箱" min-width="220">
                <template #default="{ row }">
                  <el-input v-model="row.email" placeholder="邮箱" />
                </template>
              </el-table-column>
            </el-table>
          </el-collapse-item>

          <el-collapse-item title="客户标签与偏好" name="tags">
            <el-form :model="form" label-width="120px">
              <el-form-item label="客户标签">
                <el-select v-model="form.tags" multiple collapse-tags placeholder="请选择标签">
                  <el-option label="战略客户" value="strategic" />
                  <el-option label="重点跟进" value="focus" />
                  <el-option label="需要授信" value="credit" />
                  <el-option label="支持电子合同" value="e-contract" />
                </el-select>
              </el-form-item>
              <el-form-item label="沟通偏好">
                <el-checkbox-group v-model="form.preferences">
                  <el-checkbox value="wechat">企业微信</el-checkbox>
                  <el-checkbox value="email">邮件</el-checkbox>
                  <el-checkbox value="phone">电话</el-checkbox>
                  <el-checkbox value="sms">短信</el-checkbox>
                </el-checkbox-group>
              </el-form-item>
              <el-form-item label="备注说明">
                <el-input v-model="form.remark" type="textarea" :rows="4" placeholder="请输入客户备注" />
              </el-form-item>
            </el-form>
          </el-collapse-item>
        </el-collapse>
      </el-col>

      <el-col :span="6">
        <el-card header="客户查重提示">
          <el-input
            v-model="duplicateKeyword"
            placeholder="输入关键词后按 Enter 查重"
            @keyup.enter="runDuplicateCheck"
          />
          <div class="duplicate-result">
            <div class="duplicate-title">最近查重结果</div>
            <div v-if="duplicateLogs.length === 0" class="empty-log">暂无查重结果</div>
            <div v-for="(item, idx) in duplicateLogs" :key="idx" class="log-item">{{ item }}</div>
          </div>
        </el-card>

        <el-card header="创建记录" style="margin-top: 20px">
          <div class="log-list">
            <div v-if="createLogs.length === 0" class="empty-log">暂无创建记录</div>
            <div v-for="(item, idx) in createLogs" :key="idx" class="log-item">{{ item }}</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <div class="page-actions">
      <el-button @click="saveDraft">保存草稿</el-button>
      <el-button type="primary" @click="createCustomer">创建客户</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'

const activePanels = ref(['settlement', 'contacts', 'tags'])
const duplicateKeyword = ref('')
const duplicateLogs = ref<string[]>([])
const createLogs = ref<string[]>([])

const form = reactive({
  customerName: '',
  shortName: '',
  customerCode: '',
  industry: '',
  level: 'a',
  region: [] as string[],
  settlementSubject: '',
  paymentTerm: '',
  invoiceTitle: '',
  invoiceTaxNo: '',
  invoiceAddress: '',
  tags: [] as string[],
  preferences: [] as string[],
  remark: '',
})

const contacts = ref([
  { name: '王琳', role: 'biz', mobile: '', email: '' },
  { name: '赵鹏', role: 'finance', mobile: '', email: '' },
])

const regionOptions = [
  {
    value: 'east',
    label: '华东',
    children: [
      { value: 'shanghai', label: '上海' },
      { value: 'suzhou', label: '苏州' },
      { value: 'hangzhou', label: '杭州' },
    ],
  },
  {
    value: 'south',
    label: '华南',
    children: [
      { value: 'shenzhen', label: '深圳' },
      { value: 'guangzhou', label: '广州' },
      { value: 'xiamen', label: '厦门' },
    ],
  },
]

function runDuplicateCheck() {
  const keyword = duplicateKeyword.value.trim() || '空关键词'
  duplicateLogs.value.unshift(`查重完成：${keyword}，未发现高相似客户`)
  ElMessage.success('客户查重已完成')
}

function saveDraft() {
  const label = form.customerName || '未命名客户'
  createLogs.value.unshift(`草稿已保存：${label}`)
  ElMessage.success('客户草稿已保存')
}

function createCustomer() {
  const label = form.customerName || '未命名客户'
  createLogs.value.unshift(`客户已创建：${label}`)
  ElMessage.success(`企业客户「${label}」已创建`)
}
</script>

<style scoped>
.page-stack {
  display: flex;
  flex-direction: column;
}
.page-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 20px;
}
.duplicate-result,
.log-list {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 120px;
}
.duplicate-title {
  font-size: 12px;
  color: #909399;
}
.log-item {
  padding: 8px 10px;
  border-radius: 8px;
  background: #f4f7fb;
  font-size: 12px;
  color: #303133;
}
.empty-log {
  font-size: 12px;
  color: #909399;
}
</style>
