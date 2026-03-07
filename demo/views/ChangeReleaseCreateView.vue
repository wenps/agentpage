<template>
  <div class="page-stack">
    <el-row :gutter="20">
      <el-col :span="18">
        <el-card header="发布单基础信息">
          <el-form :model="form" label-width="120px">
            <el-row :gutter="16">
              <el-col :span="12">
                <el-form-item label="发布单名称">
                  <el-input v-model="form.releaseName" placeholder="例如：支付域夜间灰度发布" />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="变更类型">
                  <el-select v-model="form.changeType" placeholder="请选择变更类型">
                    <el-option label="功能发布" value="feature" />
                    <el-option label="配置变更" value="config" />
                    <el-option label="紧急修复" value="hotfix" />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="所属系统">
                  <el-select v-model="form.system" filterable placeholder="请选择系统">
                    <el-option label="支付中台" value="payment" />
                    <el-option label="订单中心" value="order" />
                    <el-option label="会员平台" value="member" />
                    <el-option label="结算中心" value="settlement" />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="发布环境">
                  <el-radio-group v-model="form.environment">
                    <el-radio value="prod">生产</el-radio>
                    <el-radio value="staging">预发</el-radio>
                    <el-radio value="gray">灰度</el-radio>
                  </el-radio-group>
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="发布时间窗">
                  <el-date-picker
                    v-model="form.window"
                    type="datetimerange"
                    range-separator="至"
                    start-placeholder="开始时间"
                    end-placeholder="结束时间"
                  />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="风险等级">
                  <el-select v-model="form.riskLevel" placeholder="请选择风险等级">
                    <el-option label="低风险" value="low" />
                    <el-option label="中风险" value="medium" />
                    <el-option label="高风险" value="high" />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="发布负责人">
                  <el-input v-model="form.owner" placeholder="请输入负责人姓名" />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="测试负责人">
                  <el-input v-model="form.qaOwner" placeholder="请输入测试负责人" />
                </el-form-item>
              </el-col>
            </el-row>
          </el-form>
        </el-card>

        <el-card header="执行策略" style="margin-top: 20px">
          <el-form :model="form" label-width="120px">
            <el-form-item label="执行方式">
              <el-radio-group v-model="form.executionMode">
                <el-radio value="rolling">滚动发布</el-radio>
                <el-radio value="blueGreen">蓝绿发布</el-radio>
                <el-radio value="canary">金丝雀发布</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="目标集群">
              <el-checkbox-group v-model="form.clusters">
                <el-checkbox value="cn-hz-a">杭州主集群</el-checkbox>
                <el-checkbox value="cn-hz-b">杭州灰度集群</el-checkbox>
                <el-checkbox value="cn-sh-a">上海主集群</el-checkbox>
                <el-checkbox value="cn-bj-a">北京容灾集群</el-checkbox>
              </el-checkbox-group>
            </el-form-item>
            <el-form-item label="通知策略">
              <el-switch v-model="form.sendNotice" active-text="自动通知" inactive-text="不通知" />
            </el-form-item>
            <el-form-item label="回滚预案">
              <el-input v-model="form.rollbackPlan" type="textarea" :rows="4" placeholder="请填写回滚步骤和负责人" />
            </el-form-item>
          </el-form>
        </el-card>

        <el-card header="执行步骤" style="margin-top: 20px">
          <el-table :data="steps" border style="width: 100%">
            <el-table-column label="步骤" width="80">
              <template #default="{ $index }">{{ $index + 1 }}</template>
            </el-table-column>
            <el-table-column label="执行内容">
              <template #default="{ row }">
                <el-input v-model="row.name" placeholder="请输入执行动作" />
              </template>
            </el-table-column>
            <el-table-column label="负责人" width="180">
              <template #default="{ row }">
                <el-input v-model="row.owner" placeholder="负责人" />
              </template>
            </el-table-column>
            <el-table-column label="预计耗时(分钟)" width="180">
              <template #default="{ row }">
                <el-input-number v-model="row.cost" :min="1" :max="240" />
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>

      <el-col :span="6">
        <el-card header="审批信息">
          <el-form :model="form" label-width="92px">
            <el-form-item label="审批人">
              <el-select v-model="form.approver" placeholder="请选择审批人">
                <el-option label="张雪 / SRE" value="zhangxue" />
                <el-option label="李航 / CTO" value="lihang" />
                <el-option label="王雨 / 值班经理" value="wangyu" />
              </el-select>
            </el-form-item>
            <el-form-item label="抄送人">
              <el-select v-model="form.ccList" multiple collapse-tags placeholder="请选择抄送人">
                <el-option label="研发群" value="rd-group" />
                <el-option label="测试群" value="qa-group" />
                <el-option label="值班群" value="ops-group" />
              </el-select>
            </el-form-item>
            <el-form-item label="影响范围">
              <el-input v-model="form.impact" type="textarea" :rows="4" placeholder="请输入影响说明" />
            </el-form-item>
          </el-form>
        </el-card>

        <el-card header="最近提交记录" style="margin-top: 20px">
          <div class="log-list">
            <div v-if="submitLogs.length === 0" class="empty-log">暂无提交记录</div>
            <div v-for="(item, idx) in submitLogs" :key="idx" class="log-item">{{ item }}</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <div class="page-actions">
      <el-button @click="saveDraft">保存草稿</el-button>
      <el-button type="primary" @click="submitRelease">提交审批</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'

const form = reactive({
  releaseName: '',
  changeType: '',
  system: '',
  environment: 'prod',
  window: null as [Date, Date] | null,
  riskLevel: '',
  owner: '',
  qaOwner: '',
  executionMode: 'rolling',
  clusters: [] as string[],
  sendNotice: true,
  rollbackPlan: '',
  approver: '',
  ccList: [] as string[],
  impact: '',
})

const steps = ref([
  { name: '发布前检查配置中心', owner: '李娜', cost: 10 },
  { name: '灰度发布支付服务', owner: '周航', cost: 20 },
  { name: '观测 15 分钟后扩大流量', owner: '王晨', cost: 15 },
])

const submitLogs = ref<string[]>([])

function saveDraft() {
  const label = form.releaseName || '未命名发布单'
  submitLogs.value.unshift(`草稿已保存：${label}`)
  ElMessage.success('发布单草稿已保存')
}

function submitRelease() {
  const label = form.releaseName || '未命名发布单'
  submitLogs.value.unshift(`已提交审批：${label}`)
  ElMessage.success(`发布单「${label}」已提交审批`)
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
.log-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 120px;
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
